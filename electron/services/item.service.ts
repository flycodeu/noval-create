import { asc, eq } from 'drizzle-orm'
import type {
  Character as AppCharacter,
  EntityRegenerateOptions,
  MapNodeSummary,
  StoryArc as AppStoryArc,
  StoryItem as AppStoryItem,
  StoryItemDetailContext,
  StoryItemSourceContext,
  TimelineEvent as AppTimelineEvent,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import { characters, novels, storyArcs, storyItems, timelineEvents, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { runChatTask } from './task.service'
import { removeStoryItemFromEvents, syncStoryItemTimelineLinks } from './link-sync.service'
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
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { markNovelContextChanged } from './context-impact.service'
import { appendVariationMessage } from './variation-control.service'

type StoryItemStatus = 'available' | 'consumed' | 'hidden' | 'destroyed'

interface StoryItemGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
  templateOnly?: boolean
  refreshTemplates?: boolean
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
      }))
      .filter((item) => item.page || item.label || item.detectedAt)
  } catch {
    return []
  }
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
    affiliatedFactionIdsJson: row.affiliatedFactionIdsJson ?? undefined,
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
    campFactionIdsJson: row.campFactionIdsJson ?? undefined,
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
    derivedInstances: [],
    siblingInstances: [],
    sourceContexts: [],
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
    `You are the item editor for a Chinese long-form novel. ${input.mode === 'replace' ? 'Replace' : 'Repair'} the following story item while keeping it usable inside the current novel.`,
    buildSection('Story Context', [
      `Novel: ${input.novelTitle}`,
      `Genre: ${input.genre || 'Not provided'}`,
      `Background: ${input.background || 'Not provided'}`,
      `World rules: ${input.worldSummary || 'Not provided'}`,
      `Story core: ${input.storyCore || 'Not provided'}`,
    ]),
    buildSection('Current Item', [input.currentSummary]),
    buildSection('Nearby Assets', [
      input.characterSummary ? `Characters:\n${input.characterSummary}` : '',
      input.locationSummary ? `Locations:\n${input.locationSummary}` : '',
      input.eventSummary ? `Timeline events:\n${input.eventSummary}` : '',
    ]),
    buildSection('Repair Goal', [
      input.mode === 'replace'
        ? 'Keep the same asset slot, but change the name, hook, leverage point, and payoff role in a clearly different direction.'
        : 'Keep the same asset slot, but remove repetition, vague AI-sounding phrasing, and missing story utility.',
      'The item must stay concrete, reusable, and anchored to at least one character, place, or event.',
      'Return one JSON object only and keep the same field schema as batch item generation.',
    ]),
    buildSection('Output Contract', [
      '{"template_name":"existing template name or empty","item_name":"concrete item name","category":"category","sub_type":"specific subtype","rarity":"common/rare/core/forbidden","owner_name":"existing owner name or empty","location_name":"existing location name or empty","event_title":"existing event title or empty","summary":"one-sentence description","acquisition_method":"how it is obtained","usage_method":"how it is used","cost":"concrete cost","risk":"concrete risk","plot_function":"specific story function","appearance":"recognizable appearance","faction_hint":"related faction or organization","linked_character_names":["related character A"],"tags":["tag1","tag2"]}',
    ]),
  ].filter(Boolean).join('\n\n')
}

function buildSection(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')

  return body ? `[${title}]\n${body}` : ''
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
    `You are the item editor for a Chinese long-form novel. Generate ${input.count} concrete story item instances for "${input.novelTitle}".`,
    buildSection('Task Goal', [
      'Generate concrete, reusable item instances instead of abstract concepts or loose category labels.',
      'Every item must attach to a character, location, event, faction, or explicit circulation path so later chapters can call it back directly.',
      'All generated field values must read as natural Chinese that matches the existing novel setting unless a term is already established in another language.',
      input.focus ? `Current batch focus: ${input.focus}` : '',
    ]),
    buildSection('Story Context', [
      `Genre: ${input.genre}`,
      `Background: ${input.background || 'Not provided'}`,
      `World rules: ${input.worldSummary || 'Not provided'}`,
      `Story core: ${input.storyCore || 'Not provided'}`,
    ]),
    buildSection('Existing Templates', [input.templateSummary || 'No template summary provided']),
    buildSection('Characters', [input.characterSummary || 'No characters available']),
    buildSection('Locations', [input.locationSummary || 'No locations available']),
    buildSection('Factions', [input.factionSummary || 'No factions available']),
    buildSection('Story Arcs', [input.arcSummary || 'No story arcs available']),
    buildSection('Timeline Events', [input.eventSummary || 'No timeline events available']),
    buildSection('Existing Item Instances', [input.existingItemSummary || 'No existing item instances']),
    buildSection('Context Guardrails', [
      buildContextAlignmentRules({
        background: input.background,
        storyCore: input.storyCore,
        worldSummary: input.worldSummary,
        taskFocus: 'Generate grounded item instances that can be traced, reused, and called back in later chapters.',
        extraLines: [
          'Prefer existing characters, locations, events, factions, and templates before inventing anything new.',
          'Each item must answer: why it appears now, who uses or fights over it, and what changes after it appears.',
        ],
      }),
    ]),
    buildSection('Reality Guardrails', [
      buildGenreRealityRules({
        genre: input.genre,
        worldSummary: input.worldSummary,
        extraLines: [
          'Item power, rarity, circulation, maintenance, and danger must fit the current world order and resource logic.',
          'Do not introduce sudden black-box artifacts, omnipotent plot devices, or unexplained cross-genre technology jumps.',
        ],
      }),
    ]),
    buildSection('Output Quality Floor', [
      buildOutputQualityRules([
        'summary, plot_function, cost, and risk must stay concrete and factual; prioritize conditions, actions, limits, and consequences.',
        'Each item must bind to at least one person, place, or event; if that is impossible, explain a clear source and destination within the fields.',
        'Do not output omnipotent props, fate props, empty symbolic props, or objects that only exist to say they push the plot.',
        'Do not repeat existing item names, functions, origins, or payoff roles.',
        'Avoid slogan-like phrasing, pseudo-poetic metaphors, floating abstractions, and fake depth.',
      ], input.genre),
    ]),
    buildSection('Language Rules', [
      buildHumanLanguageRules([
        'Name the item like something a human editor would put on a story asset board, not like a marketing slogan.',
        'Keep summary, plot_function, cost, and risk in short natural sentences instead of abstract declarations.',
        'Only write information directly relevant to the item itself; do not drift into encyclopedia mode or unrelated world exposition.',
      ]),
    ]),
    buildSection('Generation Requirements', [
      `Return exactly ${input.count} item instances. The JSON array length must equal ${input.count}.`,
      'template_name should match an existing template when possible. If there is no good template, leave it empty but keep item_name fully concrete.',
      'owner_name, location_name, and event_title should reuse existing assets whenever possible. Leave them empty instead of fabricating new proper nouns.',
      'summary should answer what the item is; plot_function should answer which conflict, payoff, or leverage point it affects; cost and risk should state clear tradeoffs and consequences.',
      'linked_character_names should contain 0 to 3 strongly related characters. tags should contain 2 to 5 short labels.',
      'rarity, acquisition_method, usage_method, appearance, and faction_hint must all be specific and grounded.',
    ]),
    buildSection('Output Contract', [
      'Return JSON array only. No explanation. No markdown. No code fences.',
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
  const linkedCharacterIds = resolveCharacterIds(
    context.characterRows,
    toStringArray(item.linked_character_names).concat(ownerCharacterId ? [] : toStringArray(item.owner_name)),
  )

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
    linkedTimelineEventIdsJson: stringifyNumberArray(typeof eventId === 'number' ? [eventId] : []),
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
  const [itemRows, characterRows, eventRows, arcRows, mapRows] = [
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
    derivedInstances,
    siblingInstances,
    sourceContexts: parseSourceContexts(mappedCurrent.sourceContextJson),
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
  const result = db.insert(storyItems).values({
    novelId,
    itemKind: 'instance',
    itemName: data.itemName || 'Unnamed item',
    recordStatus: normalizeRecordStatus(data.recordStatus),
    status: 'available',
    linkedCharacterIdsJson: '[]',
    linkedTimelineEventIdsJson: '[]',
    tagsJson: '[]',
    sortOrder,
    ...payload,
  }).run()
  const id = Number(result.lastInsertRowid)
  syncStoryItemTimelineLinks(id)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Story items changed')
  }
  return id
}

export function updateStoryItem(
  id: number,
  data: Partial<typeof storyItems.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  db.update(storyItems).set({
    ...sanitizeStoryItemPayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(storyItems.id, id)).run()
  syncStoryItemTimelineLinks(id)
  if (!options.skipContextTracking) {
    const current = getStoryItem(id)
    if (current) {
      markNovelContextChanged(current.novelId, 'Story items changed')
    }
  }
}

export function deleteStoryItem(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = getStoryItem(id)
  removeStoryItemFromEvents(id)
  db.delete(storyItems).where(eq(storyItems.id, id)).run()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Story items changed')
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
  }
}

export async function generateStoryItems(
  novelId: number,
  options: StoryItemGenerateOptions = {},
): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const itemProfile = getItemGenerationProfile(profile.genre)
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
  const totalCount = Math.min(Math.max(options.count || itemProfile.defaultBatch, 4), 24)
  const batchSize = Math.max(1, Math.min(totalCount, options.batchSize || Math.min(totalCount, 4)))

  const createdIds: number[] = []
  const historyEntityType = 'item'
  const historyTaskType = 'story_item_generate_batch'
  let nextSort = getNextSortOrder(novelId)

  for (let generatedCount = 0; generatedCount < totalCount; generatedCount += batchSize) {
    const currentBatchCount = Math.min(batchSize, totalCount - generatedCount)
    const currentItems = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()

    const prompt = buildPrompt({
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
      templateSummary: buildItemTemplateSummary(itemProfile),
      characterSummary: buildCharacterSummary(characterRows),
      locationSummary: buildLocationSummary(mapRows),
      factionSummary: getFactionNameOptions(rules).join(', '),
      arcSummary: buildArcSummary(arcRows),
      eventSummary: buildEventSummary(eventRows),
      existingItemSummary: buildExistingItemSummary(currentItems),      focus: [options.focus, `Batch ${Math.floor(generatedCount / batchSize) + 1}: add ${currentBatchCount} new item instances and avoid duplicating existing items.`].filter(Boolean).join('\n'),
      count: currentBatchCount,
    })
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
      attemptNumber,
      rejectedDigests,
    })

    const result = await runChatTask({
      type: 'generate_items',
      novelId,
      messages,
      modelConfigId: novel.modelConfigId || undefined,
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
    let parsed: GeneratedStoryItem[]
    try {
      parsed = cleanAiValue(safeParseJson<GeneratedStoryItem[]>(result))
    } catch (error) {
      markRejected(historyId)
      throw error
    }
    if (!Array.isArray(parsed)) {
      markRejected(historyId)
      throw new Error('物品生成结果不是有效数组。')
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
      characterSummary: buildCharacterSummary(characterRows),
      locationSummary: buildLocationSummary(mapRows),
      eventSummary: buildEventSummary(eventRows),
      currentSummary: buildItemCurrentSummary(current),
      mode,
    }),
  }], {
    attemptNumber,
    rejectedDigests,
  })

  const result = await runChatTask({
    type: 'generate_items',
    novelId: current.novelId,
    relatedEntityType: 'item',
    relatedEntityId: current.id,
    messages,
    modelConfigId: novel.modelConfigId || undefined,
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)
  let parsed: GeneratedStoryItem
  try {
    parsed = cleanAiValue(safeParseJson<GeneratedStoryItem>(result))
  } catch {
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
  return getStoryItem(id)
}

