import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapters,
  characters,
  novels,
  storyArcs,
  storyItems,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { buildTimelineEventsPrompt } from './story-prompts'
import { runChatTask } from './task.service'
import { removeTimelineEventFromItems, syncTimelineEventItemLinks } from './link-sync.service'
import {
  buildTimelineConfigSummary,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'

type TimelineStatus = 'planned' | 'seeded' | 'written' | 'resolved'

interface TimelineGenerateOptions {
  count?: number
  focus?: string
}

interface GeneratedTimelineEvent {
  time_mode?: unknown
  time_label?: unknown
  time_sort_value?: unknown
  time_precision?: unknown
  event_title?: unknown
  event_summary?: unknown
  is_major_event?: unknown
  event_type?: unknown
  arc_name?: unknown
  chapter_start_num?: unknown
  chapter_end_num?: unknown
  location_name?: unknown
  present_characters?: unknown
  affected_characters?: unknown
  protagonist_present?: unknown
  protagonist_action?: unknown
  event_cause?: unknown
  event_process?: unknown
  event_result?: unknown
  linked_items?: unknown
  direct_consequences?: unknown
  open_threads?: unknown
  notes?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))
      ? Number(value)
      : undefined
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,，、]/))
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

function stringifyStringArray(values: string[]): string {
  return JSON.stringify(cleanAiStringArray(values))
}

function stringifyNumberArray(values: number[]): string {
  return JSON.stringify(values.filter((value) => Number.isFinite(value)))
}

function normalizeLookupName(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
}

function normalizeStatus(value: unknown, fallback: TimelineStatus = 'planned'): TimelineStatus {
  const text = asText(value)
  if (text === 'seeded' || text === 'written' || text === 'resolved') return text
  return fallback
}

function normalizeTimeMode(value: unknown, fallback: string): string {
  const text = asText(value)
  return text || fallback
}

function flattenMapTree(
  nodes: Array<typeof worldMap.$inferSelect>,
  parentId: number | null = null,
): Array<typeof worldMap.$inferSelect> {
  return nodes
    .filter((node) => (node.parentId ?? null) === parentId)
    .flatMap((node) => [node, ...flattenMapTree(nodes, node.id)])
}

function resolveIdByName<T extends { id: number }>(
  items: T[],
  getName: (item: T) => string,
  input: unknown,
): number | undefined {
  const target = normalizeLookupName(asText(input))
  if (!target) return undefined

  const exact = items.find((item) => normalizeLookupName(getName(item)) === target)
  if (exact) return exact.id

  const fuzzy = items.find((item) => {
    const name = normalizeLookupName(getName(item))
    return Boolean(name) && (name.includes(target) || target.includes(name))
  })
  return fuzzy?.id
}

function resolveCharacterIds(
  characterRows: Array<typeof characters.$inferSelect>,
  names: string[],
): number[] {
  const ids = names
    .map((name) => resolveIdByName(characterRows, (item) => item.fullName, name))
    .filter((item): item is number => typeof item === 'number')
  return [...new Set(ids)]
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return [
    `故事目标：${profile.storyGoal || '未填写'}`,
    `核心冲突：${profile.coreConflict || '未填写'}`,
    `主线剧情：${profile.mainPlot || '未填写'}`,
    `支线剧情：${profile.subPlots || '暂无'}`,
    `结局方向：${profile.ending || '未填写'}`,
  ].join('\n')
}

function buildArcSummary(rows: Array<typeof storyArcs.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .sort((left, right) => left.arcOrder - right.arcOrder)
    .map((arc) => {
      const range = arc.chapterStart || arc.chapterEnd
        ? `第${arc.chapterStart || '?'}章-第${arc.chapterEnd || '?'}章`
        : '章节范围待定'
      return `- ${arc.arcName}｜${range}｜${arc.arcGoal || arc.arcSummary || '暂无说明'}`
    })
    .join('\n')
}

function buildCharacterSummary(rows: Array<typeof characters.$inferSelect>): string {
  if (rows.length === 0) return ''
  const priority = ['protagonist', 'major', 'antagonist', 'supporting', 'minor']
  return [...rows]
    .sort((left, right) => priority.indexOf(left.roleType || 'minor') - priority.indexOf(right.roleType || 'minor'))
    .slice(0, 10)
    .map((character) => {
      const parts = [
        character.roleType || 'minor',
        character.species || '',
        character.rankLevel || '',
        character.goals || '',
      ].filter(Boolean)
      return `- ${character.fullName}｜${parts.join('｜') || '暂无补充'}`
    })
    .join('\n')
}

function buildLocationSummary(rows: Array<typeof worldMap.$inferSelect>): string {
  if (rows.length === 0) return ''
  return flattenMapTree(rows)
    .slice(0, 12)
    .map((location) => {
      const parts = [
        location.level ? `层级${location.level}` : '',
        location.nodeType || location.locationType || '',
        location.structureRole || '',
      ].filter(Boolean)
      return `- ${location.name}${parts.length > 0 ? `｜${parts.join('｜')}` : ''}`
    })
    .join('\n')
}

function buildExistingEventSummary(rows: Array<typeof timelineEvents.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .slice(0, 10)
    .map((event) => {
      const parts = [
        event.timeLabel,
        event.eventTitle,
        event.eventType || '',
        event.status || '',
      ].filter(Boolean)
      return `- ${parts.join('｜')}`
    })
    .join('\n')
}

function buildItemSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .filter((item) => item.itemKind === 'instance')
    .slice(0, 12)
    .map((item) => {
      const parts = [
        item.category || '',
        item.ownerCharacterId ? `角色#${item.ownerCharacterId}` : '',
        item.locationMapId ? `地点#${item.locationMapId}` : '',
        item.plotFunction || item.summary || '',
      ].filter(Boolean)
      return `- ${item.itemName}${parts.length > 0 ? `｜${parts.join('｜')}` : ''}`
    })
    .join('\n')
}

function sanitizeTimelinePayload(
  data: Partial<typeof timelineEvents.$inferInsert>,
): Partial<typeof timelineEvents.$inferInsert> {
  const next: Partial<typeof timelineEvents.$inferInsert> = {}

  if (typeof data.sortOrder === 'number') next.sortOrder = Math.round(data.sortOrder)
  if (typeof data.eventTitle === 'string') next.eventTitle = cleanAiFieldText(data.eventTitle)
  if (typeof data.eventSummary === 'string') next.eventSummary = cleanAiFieldText(data.eventSummary)
  if (typeof data.timeMode === 'string') next.timeMode = cleanAiFieldText(data.timeMode)
  if (typeof data.timeLabel === 'string') next.timeLabel = cleanAiFieldText(data.timeLabel)
  if (typeof data.timeSortValue === 'number') next.timeSortValue = data.timeSortValue
  if (typeof data.timePrecision === 'string') next.timePrecision = cleanAiFieldText(data.timePrecision)
  if (typeof data.isMajorEvent === 'number') next.isMajorEvent = data.isMajorEvent ? 1 : 0
  if (typeof data.eventType === 'string') next.eventType = cleanAiFieldText(data.eventType)
  if ('arcId' in data) next.arcId = data.arcId ?? null
  if ('chapterStartId' in data) next.chapterStartId = data.chapterStartId ?? null
  if ('chapterEndId' in data) next.chapterEndId = data.chapterEndId ?? null
  if ('locationMapId' in data) next.locationMapId = data.locationMapId ?? null
  if (typeof data.presentCharacterIdsJson === 'string') next.presentCharacterIdsJson = data.presentCharacterIdsJson
  if (typeof data.affectedCharacterIdsJson === 'string') next.affectedCharacterIdsJson = data.affectedCharacterIdsJson
  if (typeof data.protagonistPresent === 'number') next.protagonistPresent = data.protagonistPresent ? 1 : 0
  if (typeof data.protagonistAction === 'string') next.protagonistAction = cleanAiFieldText(data.protagonistAction)
  if (typeof data.eventCause === 'string') next.eventCause = cleanAiFieldText(data.eventCause)
  if (typeof data.eventProcess === 'string') next.eventProcess = cleanAiFieldText(data.eventProcess)
  if (typeof data.eventResult === 'string') next.eventResult = cleanAiFieldText(data.eventResult)
  if (typeof data.linkedItemIdsJson === 'string') next.linkedItemIdsJson = data.linkedItemIdsJson
  if (typeof data.directConsequencesJson === 'string') next.directConsequencesJson = data.directConsequencesJson
  if (typeof data.openThreadsJson === 'string') next.openThreadsJson = data.openThreadsJson
  if (typeof data.notes === 'string') next.notes = cleanAiFieldText(data.notes)
  if (typeof data.status === 'string') next.status = normalizeStatus(data.status)

  return next
}

function buildGeneratedPayload(
  raw: GeneratedTimelineEvent,
  context: {
    defaultTimeMode: string
    defaultPrecision: string
    sortOrder: number
    arcRows: Array<typeof storyArcs.$inferSelect>
    chapterRows: Array<typeof chapters.$inferSelect>
    characterRows: Array<typeof characters.$inferSelect>
    itemRows: Array<typeof storyItems.$inferSelect>
    mapRows: Array<typeof worldMap.$inferSelect>
  },
): Partial<typeof timelineEvents.$inferInsert> | null {
  const event = cleanAiValue(raw)
  const eventTitle = asText(event.event_title)
  const timeLabel = asText(event.time_label)
  if (!eventTitle || !timeLabel) return null

  const chapterStartNum = asNumber(event.chapter_start_num)
  const chapterEndNum = asNumber(event.chapter_end_num)
  const chapterStartId = typeof chapterStartNum === 'number'
    ? context.chapterRows.find((chapter) => chapter.chapterNum === chapterStartNum)?.id
    : undefined
  const chapterEndId = typeof chapterEndNum === 'number'
    ? context.chapterRows.find((chapter) => chapter.chapterNum === chapterEndNum)?.id
    : undefined

  const presentCharacters = resolveCharacterIds(context.characterRows, toStringArray(event.present_characters))
  const affectedCharacters = resolveCharacterIds(context.characterRows, toStringArray(event.affected_characters))
  const linkedItems = toStringArray(event.linked_items)
    .map((name) => resolveIdByName(context.itemRows, (item) => item.itemName, name))
    .filter((item): item is number => typeof item === 'number')

  return {
    sortOrder: context.sortOrder,
    eventTitle,
    eventSummary: asText(event.event_summary),
    timeMode: normalizeTimeMode(event.time_mode, context.defaultTimeMode),
    timeLabel,
    timeSortValue: asNumber(event.time_sort_value) ?? context.sortOrder,
    timePrecision: asText(event.time_precision) || context.defaultPrecision,
    isMajorEvent: asNumber(event.is_major_event) === 0 ? 0 : 1,
    eventType: asText(event.event_type),
    arcId: resolveIdByName(context.arcRows, (item) => item.arcName, event.arc_name) ?? null,
    chapterStartId: chapterStartId ?? null,
    chapterEndId: chapterEndId ?? null,
    locationMapId: resolveIdByName(context.mapRows, (item) => item.name, event.location_name) ?? null,
    presentCharacterIdsJson: stringifyNumberArray(presentCharacters),
    affectedCharacterIdsJson: stringifyNumberArray(affectedCharacters),
    protagonistPresent: asNumber(event.protagonist_present) === 0 ? 0 : 1,
    protagonistAction: asText(event.protagonist_action),
    eventCause: asText(event.event_cause),
    eventProcess: asText(event.event_process),
    eventResult: asText(event.event_result),
    linkedItemIdsJson: stringifyNumberArray([...new Set(linkedItems)]),
    directConsequencesJson: stringifyStringArray(toStringArray(event.direct_consequences)),
    openThreadsJson: stringifyStringArray(toStringArray(event.open_threads)),
    notes: asText(event.notes),
    status: 'planned',
  }
}

function getNextSortOrder(novelId: number): number {
  const rows = listTimelineEvents(novelId)
  return rows.length > 0 ? Math.max(...rows.map((item) => item.sortOrder || 0)) + 1 : 1
}

export function listTimelineEvents(novelId: number) {
  const db = getDb()
  return db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
}

export function getTimelineEvent(id: number) {
  const db = getDb()
  return db.select().from(timelineEvents).where(eq(timelineEvents.id, id)).all()[0] || null
}

export function createTimelineEvent(novelId: number, data: Partial<typeof timelineEvents.$inferInsert>) {
  const db = getDb()
  const nextSortOrder = typeof data.sortOrder === 'number' ? data.sortOrder : getNextSortOrder(novelId)
  const result = db.insert(timelineEvents).values({
    novelId,
    sortOrder: nextSortOrder,
    eventTitle: data.eventTitle || '未命名事件',
    timeLabel: data.timeLabel || '待定时间',
    timeMode: data.timeMode || 'custom-era',
    timeSortValue: typeof data.timeSortValue === 'number' ? data.timeSortValue : nextSortOrder,
    presentCharacterIdsJson: data.presentCharacterIdsJson || '[]',
    affectedCharacterIdsJson: data.affectedCharacterIdsJson || '[]',
    linkedItemIdsJson: data.linkedItemIdsJson || '[]',
    directConsequencesJson: data.directConsequencesJson || '[]',
    openThreadsJson: data.openThreadsJson || '[]',
    protagonistPresent: typeof data.protagonistPresent === 'number' ? data.protagonistPresent : 0,
    isMajorEvent: typeof data.isMajorEvent === 'number' ? data.isMajorEvent : 1,
    status: normalizeStatus(data.status),
    ...sanitizeTimelinePayload(data),
  }).run()
  const id = Number(result.lastInsertRowid)
  syncTimelineEventItemLinks(id)
  return id
}

export function updateTimelineEvent(id: number, data: Partial<typeof timelineEvents.$inferInsert>) {
  const db = getDb()
  db.update(timelineEvents).set({
    ...sanitizeTimelinePayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(timelineEvents.id, id)).run()
  syncTimelineEventItemLinks(id)
}

export function deleteTimelineEvent(id: number) {
  const db = getDb()
  removeTimelineEventFromItems(id)
  db.delete(timelineEvents).where(eq(timelineEvents.id, id)).run()
}

export async function generateTimelineEvents(
  novelId: number,
  options: TimelineGenerateOptions = {},
): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const existingEvents = listTimelineEvents(novelId)

  const prompt = buildTimelineEventsPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    background: `${profile.background}${options.focus ? `\n额外聚焦：${options.focus}` : ''}`,
    storyGoal: profile.storyGoal,
    coreConflict: profile.coreConflict,
    mainPlot: profile.mainPlot,
    subPlots: profile.subPlots,
    ending: profile.ending,
    worldRulesSummary: `${profile.worldRulesSummary}\n\n${buildStoryCoreSummary(profile)}`,
    timelineRules: buildTimelineConfigSummary(rules),
    arcSummary: buildArcSummary(arcRows),
    characterSummary: buildCharacterSummary(characterRows),
    locationSummary: buildLocationSummary(mapRows),
    itemSummary: buildItemSummary(itemRows),
    existingEvents: buildExistingEventSummary(existingEvents),
    count: Math.min(Math.max(options.count || 10, 6), 16),
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
  })

  const result = await runChatTask({
    type: 'generate_timeline',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<GeneratedTimelineEvent[]>(result))
  if (!Array.isArray(parsed)) {
    throw new Error('时间轴生成结果不是有效数组')
  }

  const defaultPrecision = rules.timelineConfig.precisionOptions[0] || '阶段'
  const createdIds: number[] = []
  const startSortOrder = getNextSortOrder(novelId)

  parsed.forEach((raw, index) => {
    const payload = buildGeneratedPayload(raw, {
      defaultTimeMode: rules.timelineConfig.calendarType,
      defaultPrecision,
      sortOrder: startSortOrder + index,
      arcRows,
      chapterRows,
      characterRows,
      itemRows,
      mapRows,
    })
    if (!payload) return
    createdIds.push(createTimelineEvent(novelId, payload))
  })

  return createdIds
}

export function getTimelineEventOpenThreads(id: number): string[] {
  const row = getTimelineEvent(id)
  if (!row) return []
  return parseJsonStringArray(row.openThreadsJson)
}

export function getTimelineEventCharacterIds(id: number): number[] {
  const row = getTimelineEvent(id)
  if (!row) return []
  return parseJsonNumberArray(row.presentCharacterIdsJson)
}
