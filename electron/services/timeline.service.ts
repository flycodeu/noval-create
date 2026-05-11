import type { WebContents } from 'electron'
import { asc, eq, inArray } from 'drizzle-orm'
import type { EntityRegenerateOptions, TimelineGenerateOptions } from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  chapterSegments,
  chapters,
  characters,
  novels,
  storyArcs,
  storyItems,
  storyParts,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { buildTimelineEventsPrompt } from './story-prompts'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { removeTimelineEventFromItems, syncTimelineEventItemLinks } from './link-sync.service'
import { recordAssetChangeEvent } from './asset-impact.service'
import {
  buildTimelineConfigSummary,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
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
import { buildBatchKey, createOperationLog } from './history.service'
import { throwUserFacingError } from '../utils/user-facing-error'

type TimelineStatus = 'planned' | 'seeded' | 'written' | 'resolved'

export interface TimelineBatchChunkResult {
  ids: number[]
  warning?: string
  batchDigest?: string
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
  typed_refs?: unknown
  direct_consequences?: unknown
  open_threads?: unknown
  notes?: unknown
}

interface TimelineAnchorFilters {
  novelId: number
  volumeId?: number
  partId?: number
  chapterId?: number
  segmentId?: number
}

interface TimelineAnchorState {
  volumeId: number | null
  partId: number | null
  chapterStartId: number | null
  chapterEndId: number | null
  segmentId: number | null
  anchorInvalid: number
}

interface TimelineQueryFilters extends TimelineAnchorFilters {
  status?: TimelineStatus
  eventType?: string
  keyword?: string
  page?: number
  pageSize?: number
  sortBy?: 'timeSortValue' | 'createdAt'
  sortDirection?: 'asc' | 'desc'
}

interface TimelineStatsAccumulator {
  total: number
  majorCount: number
  resolvedCount: number
  openThreadCount: number
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
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
    profile.writingRulesSummary,
  ].filter(Boolean).join('\n\n')
}

function buildArcSummary(rows: Array<typeof storyArcs.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .sort((left, right) => left.arcOrder - right.arcOrder)
    .map((arc) => {
      const range = arc.chapterStart || arc.chapterEnd
        ? `第${arc.chapterStart || '?'}章 - 第${arc.chapterEnd || '?'}章`
        : '章节范围待定'
      return `- ${arc.arcName} | ${range} | ${arc.arcGoal || arc.arcSummary || '暂无说明'}`
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
      const parts = [character.roleType || 'minor', character.species || '', character.rankLevel || '', character.goals || ''].filter(Boolean)
      return `- ${character.fullName} | ${parts.join(' | ') || '暂无补充'}`
    })
    .join('\n')
}

function buildLocationSummary(rows: Array<typeof worldMap.$inferSelect>): string {
  if (rows.length === 0) return ''
  return flattenMapTree(rows)
    .slice(0, 12)
    .map((location) => {
      const parts = [location.level ? `层级${location.level}` : '', location.nodeType || location.locationType || '', location.structureRole || ''].filter(Boolean)
      return `- ${location.name}${parts.length > 0 ? ` | ${parts.join(' | ')}` : ''}`
    })
    .join('\n')
}

function buildExistingEventSummary(rows: Array<typeof timelineEvents.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .slice(0, 10)
    .map((event) => {
      const parts = [event.timeLabel, event.eventTitle, event.eventType || '', event.status || ''].filter(Boolean)
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
}

function buildItemSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  if (rows.length === 0) return ''
  return rows
    .filter((item) => item.itemKind === 'instance')
    .slice(0, 12)
    .map((item) => {
      const parts = [item.category || '', item.ownerCharacterId ? `角色#${item.ownerCharacterId}` : '', item.locationMapId ? `地点#${item.locationMapId}` : '', item.plotFunction || item.summary || ''].filter(Boolean)
      return `- ${item.itemName}${parts.length > 0 ? ` | ${parts.join(' | ')}` : ''}`
    })
    .join('\n')
}

function normalizeSignaturePart(value?: string | null): string {
  return (value || '').replace(/\s+/g, '').trim().toLowerCase()
}

function buildTimelineSignature(payload: Partial<typeof timelineEvents.$inferInsert>): string {
  return [
    normalizeSignaturePart(typeof payload.timeLabel === 'string' ? payload.timeLabel : ''),
    normalizeSignaturePart(typeof payload.eventTitle === 'string' ? payload.eventTitle : ''),
    normalizeSignaturePart(typeof payload.eventType === 'string' ? payload.eventType : ''),
    typeof payload.arcId === 'number' ? String(payload.arcId) : '',
    typeof payload.chapterStartId === 'number' ? String(payload.chapterStartId) : '',
    typeof payload.chapterEndId === 'number' ? String(payload.chapterEndId) : '',
    normalizeSignaturePart(typeof payload.openThreadsJson === 'string' ? payload.openThreadsJson : ''),
  ].filter(Boolean).join('|')
}

function buildTimelineCurrentSummary(event: typeof timelineEvents.$inferSelect): string {
  return [
    `时间标签：${event.timeLabel}`,
    `事件标题：${event.eventTitle}`,
    event.eventType ? `事件类型：${event.eventType}` : '',
    typeof event.arcId === 'number' ? `故事弧ID：${event.arcId}` : '',
    typeof event.chapterStartId === 'number' ? `起始章节ID：${event.chapterStartId}` : '',
    typeof event.chapterEndId === 'number' ? `结束章节ID：${event.chapterEndId}` : '',
    event.eventSummary ? `摘要：${event.eventSummary}` : '',
    event.eventCause ? `起因：${event.eventCause}` : '',
    event.eventProcess ? `过程：${event.eventProcess}` : '',
    event.eventResult ? `结果：${event.eventResult}` : '',
    event.protagonistAction ? `主角动作：${event.protagonistAction}` : '',
    event.notes ? `备注：${event.notes}` : '',
  ].filter(Boolean).join('\n')
}

function buildTimelineReviewContext(input: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  storyCore: string
  timelineRules: string
  arcSummary: string
  characterSummary: string
  locationSummary: string
  itemSummary: string
  existingEvents: string
  currentSummary?: string
  focus?: string
  mode?: 'repair' | 'replace'
}): string {
  return [
    `题材：${input.profile.genre}`,
    input.profile.background ? `背景：${input.profile.background}` : '',
    input.profile.worldRulesSummary ? `世界规则：${input.profile.worldRulesSummary}` : '',
    input.timelineRules ? `时间规则：${input.timelineRules}` : '',
    input.storyCore ? `故事核心：\n${input.storyCore}` : '',
    input.currentSummary ? `当前事件：\n${input.currentSummary}` : '',
    input.arcSummary ? `故事弧：\n${input.arcSummary}` : '',
    input.characterSummary ? `关键人物：\n${input.characterSummary}` : '',
    input.locationSummary ? `关键地点：\n${input.locationSummary}` : '',
    input.itemSummary ? `关键物品：\n${input.itemSummary}` : '',
    input.existingEvents ? `已有时间轴：\n${input.existingEvents}` : '',
    input.focus ? `本轮聚焦：${input.focus}` : '',
    input.mode ? `当前模式：${input.mode}` : '',
  ].filter(Boolean).join('\n\n')
}

function timelineSchemaHint(expectedCount?: number): string {
  return [
    typeof expectedCount === 'number'
      ? `输出必须保持为 ${expectedCount} 个时间轴事件对象组成的 JSON 数组。`
      : '输出必须保持为单个时间轴事件 JSON 对象。',
    '不要把事件卡改写成剧情长文或散点说明。',
    '时间标签、事件标题、起因、过程、结果、关联人物/物品/地点等字段必须保留。',
  ].join('\n')
}

function buildTimelineRepairPrompt(input: {
  novelTitle: string
  genre: string
  background: string
  worldSummary: string
  timelineRules: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  endgameDesignSummary: string
  arcSummary: string
  characterSummary: string
  locationSummary: string
  itemSummary: string
  currentSummary: string
  mode: 'repair' | 'replace'
}) {
  return [
    `请${input.mode === 'replace' ? '用明显不同的新方案替换' : '修复'}下面这个时间轴事件，保持它仍然服务于当前小说。`,
    '',
    '【故事上下文】',
    `小说：${input.novelTitle}`,
    `题材：${input.genre || '未知题材'}`,
    `背景：${input.background || '未提供'}`,
    `故事目标：${input.storyGoal || '未提供'}`,
    `核心冲突：${input.coreConflict || '未提供'}`,
    `主线剧情：${input.mainPlot || '未提供'}`,
    `结局方向：${input.ending || '未提供'}`,
    input.endgameDesignSummary ? `终局设计：${input.endgameDesignSummary}` : '',
    input.worldSummary ? `世界规则：${input.worldSummary}` : '',
    input.timelineRules ? `时间规则：${input.timelineRules}` : '',
    '',
    '【当前事件】',
    input.currentSummary,
    '',
    '【附近资产】',
    input.arcSummary ? `故事弧：\n${input.arcSummary}` : '',
    input.characterSummary ? `关键人物：\n${input.characterSummary}` : '',
    input.locationSummary ? `关键地点：\n${input.locationSummary}` : '',
    input.itemSummary ? `关键物品：\n${input.itemSummary}` : '',
    '',
    '【修复目标】',
    input.mode === 'replace'
      ? '- 保留这个事件在节奏中的功能位，但换成明显不同的事件触发、过程和后果。'
      : '- 修复时间标签、事件逻辑、后果链、AI 味和空泛表述，不要只微调措辞。',
    '- 章节锚点、人物在场、地点和物品引用必须尽量复用当前已有资产。',
    '- 只输出单个 JSON object，不要解释，不要 Markdown。',
    '{"time_mode":"gregorian/regnal/relative-disaster/custom-era/future-date","time_label":"时间标签","time_sort_value":1,"time_precision":"年/月/日/阶段","event_title":"事件标题","event_summary":"30~60字概述","is_major_event":1,"event_type":"事件类型","arc_name":"关联故事弧","chapter_start_num":1,"chapter_end_num":2,"location_name":"关联地点","present_characters":["人物A"],"affected_characters":["人物C"],"protagonist_present":1,"protagonist_action":"主角做了什么","event_cause":"事件起因","event_process":"事件过程","event_result":"事件结果","linked_items":["物品A"],"direct_consequences":["直接后果1"],"open_threads":["待回收问题1"],"notes":"补充备注"}',
  ].filter(Boolean).join('\n')
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
  if ('volumeId' in data) next.volumeId = data.volumeId ?? null
  if ('partId' in data) next.partId = data.partId ?? null
  if ('chapterStartId' in data) next.chapterStartId = data.chapterStartId ?? null
  if ('chapterEndId' in data) next.chapterEndId = data.chapterEndId ?? null
  if ('segmentId' in data) next.segmentId = data.segmentId ?? null
  if ('locationMapId' in data) next.locationMapId = data.locationMapId ?? null
  if (typeof data.presentCharacterIdsJson === 'string') next.presentCharacterIdsJson = data.presentCharacterIdsJson
  if (typeof data.affectedCharacterIdsJson === 'string') next.affectedCharacterIdsJson = data.affectedCharacterIdsJson
  if (typeof data.protagonistPresent === 'number') next.protagonistPresent = data.protagonistPresent ? 1 : 0
  if (typeof data.protagonistAction === 'string') next.protagonistAction = cleanAiFieldText(data.protagonistAction)
  if (typeof data.eventCause === 'string') next.eventCause = cleanAiFieldText(data.eventCause)
  if (typeof data.eventProcess === 'string') next.eventProcess = cleanAiFieldText(data.eventProcess)
  if (typeof data.eventResult === 'string') next.eventResult = cleanAiFieldText(data.eventResult)
  if (typeof data.linkedItemIdsJson === 'string') next.linkedItemIdsJson = data.linkedItemIdsJson
  if (typeof data.typedRefsJson === 'string') next.typedRefsJson = data.typedRefsJson
  if (typeof data.directConsequencesJson === 'string') next.directConsequencesJson = data.directConsequencesJson
  if (typeof data.openThreadsJson === 'string') next.openThreadsJson = data.openThreadsJson
  if (typeof data.notes === 'string') next.notes = cleanAiFieldText(data.notes)
  if (typeof data.anchorInvalid === 'number') next.anchorInvalid = data.anchorInvalid ? 1 : 0
  if (typeof data.status === 'string') next.status = normalizeStatus(data.status)

  return next
}

function resolveTimelineAnchorState(
  novelId: number,
  data: Partial<typeof timelineEvents.$inferInsert>,
): TimelineAnchorState {
  const db = getDb()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const partRows = db.select().from(storyParts).where(eq(storyParts.novelId, novelId)).all()
  const segmentRows = db.select().from(chapterSegments).where(eq(chapterSegments.novelId, novelId)).all()
  const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
  const partById = new Map(partRows.map((part) => [part.id, part]))
  const segmentById = new Map(segmentRows.map((segment) => [segment.id, segment]))

  const next: TimelineAnchorState = {
    volumeId: data.volumeId ?? null,
    partId: data.partId ?? null,
    chapterStartId: data.chapterStartId ?? null,
    chapterEndId: data.chapterEndId ?? null,
    segmentId: data.segmentId ?? null,
    anchorInvalid: typeof data.anchorInvalid === 'number' ? (data.anchorInvalid ? 1 : 0) : 0,
  }
  const preserveInvalidFallback = next.anchorInvalid === 1

  if (next.segmentId) {
    const segment = segmentById.get(next.segmentId)
    if (segment) {
      next.chapterStartId = segment.chapterId
      next.chapterEndId = segment.chapterId
      next.partId = segment.partId ?? null
      next.volumeId = segment.volumeId ?? null
      next.anchorInvalid = 0
      return next
    }
    next.segmentId = null
    next.anchorInvalid = 1
  }

  const anchorChapterId = next.chapterStartId ?? next.chapterEndId
  if (anchorChapterId) {
    const chapter = chapterById.get(anchorChapterId)
    if (chapter) {
      next.partId = chapter.partId ?? next.partId ?? null
      next.volumeId = chapter.volumeId
        ?? (next.partId ? partById.get(next.partId)?.volumeId ?? null : next.volumeId ?? null)
      next.anchorInvalid = 0
      return next
    }
  }

  if (next.partId) {
    const part = partById.get(next.partId)
    if (part) {
      next.volumeId = part.volumeId
      next.anchorInvalid = preserveInvalidFallback ? 1 : 0
      return next
    }
    next.partId = null
    next.anchorInvalid = 1
  }

  if (next.volumeId) {
    next.anchorInvalid = preserveInvalidFallback ? 1 : 0
  }

  return next
}

function resolveTypedPointerIds<T extends { id: number }>(
  overlayRaw: unknown,
  assetType: 'character' | 'item' | 'story_thread',
  rows: T[],
  getName: (row: T) => string,
): number[] {
  const raw = typeof overlayRaw === 'string'
    ? overlayRaw
    : overlayRaw == null
      ? undefined
      : JSON.stringify(overlayRaw)
  const overlay = parseTypedRefOverlay(raw)
  if (!overlay) return []
  return [...new Set(overlay.pointers
    .filter((pointer) => pointer.assetType === assetType)
    .map((pointer) => {
      if (typeof pointer.id === 'number') return pointer.id
      const names = [pointer.name, ...(pointer.alias || [])].filter((item): item is string => Boolean(item))
      for (const name of names) {
        const resolved = resolveIdByName(rows, getName, name)
        if (typeof resolved === 'number') return resolved
      }
      return undefined
    })
    .filter((value): value is number => typeof value === 'number'))]
}

function resolveTypedThreadNames(overlayRaw: unknown): string[] {
  const raw = typeof overlayRaw === 'string'
    ? overlayRaw
    : overlayRaw == null
      ? undefined
      : JSON.stringify(overlayRaw)
  const overlay = parseTypedRefOverlay(raw)
  if (!overlay) return []
  return [...new Set(overlay.pointers
    .filter((pointer) => pointer.assetType === 'story_thread')
    .map((pointer) => pointer.name || pointer.alias?.[0] || '')
    .filter(Boolean))]
}

function deriveTimelineTypedRefsJson(params: {
  typedRefsJson?: string | null
  presentCharacterIdsJson?: string | null
  affectedCharacterIdsJson?: string | null
  linkedItemIdsJson?: string | null
  openThreadsJson?: string | null
}): string | undefined {
  const explicit = parseTypedRefOverlay(params.typedRefsJson)
  if (explicit) return stringifyTypedRefOverlay(explicit)

  const presentCharacterIds = parseJsonNumberArray(params.presentCharacterIdsJson)
  const affectedCharacterIds = parseJsonNumberArray(params.affectedCharacterIdsJson)
  const linkedItemIds = parseJsonNumberArray(params.linkedItemIdsJson)
  const openThreadNames = parseJsonStringArray(params.openThreadsJson)
  const overlay = buildTypedRefOverlay([
    ...[...new Set([...presentCharacterIds, ...affectedCharacterIds])].map((id) => buildNameFallbackPointer('character', { id, confidence: 1 })),
    ...linkedItemIds.map((id) => buildNameFallbackPointer('item', { id, confidence: 1 })),
    ...openThreadNames.map((name) => buildNameFallbackPointer('story_thread', { name, alias: [name], confidence: 0.45 })),
  ])
  return stringifyTypedRefOverlay(overlay)
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function buildTimelineMutation(
  novelId: number,
  data: Partial<typeof timelineEvents.$inferInsert>,
  current?: typeof timelineEvents.$inferSelect | null,
): Partial<typeof timelineEvents.$inferInsert> {
  const sanitized = sanitizeTimelinePayload(data)
  const anchors = resolveTimelineAnchorState(novelId, {
    volumeId: 'volumeId' in sanitized ? sanitized.volumeId : current?.volumeId ?? null,
    partId: 'partId' in sanitized ? sanitized.partId : current?.partId ?? null,
    chapterStartId: 'chapterStartId' in sanitized ? sanitized.chapterStartId : current?.chapterStartId ?? null,
    chapterEndId: 'chapterEndId' in sanitized ? sanitized.chapterEndId : current?.chapterEndId ?? null,
    segmentId: 'segmentId' in sanitized ? sanitized.segmentId : current?.segmentId ?? null,
    anchorInvalid: 'anchorInvalid' in sanitized ? sanitized.anchorInvalid : current?.anchorInvalid ?? 0,
  })

  return {
    ...sanitized,
    ...anchors,
  }
}

function isEventLinkedToChapter(
  event: typeof timelineEvents.$inferSelect,
  chapter: typeof chapters.$inferSelect,
  chapterNumById: Map<number, number>,
  segmentIdsByChapter: Map<number, Set<number>>,
): boolean {
  if (event.segmentId && segmentIdsByChapter.get(chapter.id)?.has(event.segmentId)) return true
  if (event.chapterStartId === chapter.id || event.chapterEndId === chapter.id) return true

  const startNum = event.chapterStartId ? chapterNumById.get(event.chapterStartId) : undefined
  const endNum = event.chapterEndId ? chapterNumById.get(event.chapterEndId) : undefined
  if (typeof startNum === 'number' && typeof endNum === 'number') {
    return chapter.chapterNum >= startNum && chapter.chapterNum <= endNum
  }
  if (typeof startNum === 'number') return chapter.chapterNum === startNum
  if (typeof endNum === 'number') return chapter.chapterNum === endNum
  return false
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

  const typedRefCharacters = resolveTypedPointerIds(event.typed_refs, 'character', context.characterRows, (item) => item.fullName)
  const typedRefItems = resolveTypedPointerIds(event.typed_refs, 'item', context.itemRows, (item) => item.itemName)
  const typedThreadNames = resolveTypedThreadNames(event.typed_refs)
  const presentCharacters = typedRefCharacters.length > 0
    ? typedRefCharacters
    : resolveCharacterIds(context.characterRows, toStringArray(event.present_characters))
  const affectedCharacters = typedRefCharacters.length > 0
    ? [...new Set(typedRefCharacters)]
    : resolveCharacterIds(context.characterRows, toStringArray(event.affected_characters))
  const linkedItems = typedRefItems.length > 0
    ? typedRefItems
    : toStringArray(event.linked_items)
        .map((name) => resolveIdByName(context.itemRows, (item) => item.itemName, name))
        .filter((item): item is number => typeof item === 'number')
  const typedRefsJson = stringifyTypedRefOverlay(buildTypedRefOverlay([
    ...presentCharacters.map((id) => buildNameFallbackPointer('character', {
      id,
      name: context.characterRows.find((row) => row.id === id)?.fullName,
      confidence: typedRefCharacters.includes(id) ? 0.98 : 0.8,
    })),
    ...affectedCharacters
      .filter((id) => !presentCharacters.includes(id))
      .map((id) => buildNameFallbackPointer('character', {
        id,
        name: context.characterRows.find((row) => row.id === id)?.fullName,
        confidence: 0.78,
      })),
    ...linkedItems.map((id) => buildNameFallbackPointer('item', {
      id,
      name: context.itemRows.find((row) => row.id === id)?.itemName,
      confidence: typedRefItems.includes(id) ? 0.98 : 0.8,
    })),
    ...typedThreadNames.map((name) => buildNameFallbackPointer('story_thread', {
      name,
      alias: [name],
      confidence: 0.45,
    })),
    ...toStringArray(event.open_threads)
      .filter((name) => !typedThreadNames.includes(name))
      .map((name) => buildNameFallbackPointer('story_thread', {
        name,
        alias: [name],
        confidence: 0.4,
      })),
  ]))

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
    ...(typedRefsJson ? { typedRefsJson } : {}),
    directConsequencesJson: stringifyStringArray(toStringArray(event.direct_consequences)),
    openThreadsJson: stringifyStringArray([...new Set([...typedThreadNames, ...toStringArray(event.open_threads)])]),
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

export function listLinkedTimelineEvents(filters: TimelineAnchorFilters) {
  const db = getDb()
  const events = listTimelineEvents(filters.novelId)
  if (filters.segmentId) {
    return events.filter((event) => event.segmentId === filters.segmentId)
  }
  if (filters.chapterId) {
    const chapter = db.select().from(chapters).where(eq(chapters.id, filters.chapterId)).all()[0]
    if (!chapter) return []
    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, filters.novelId)).all()
    const chapterNumById = new Map(chapterRows.map((item) => [item.id, item.chapterNum]))
    const segmentRows = db.select().from(chapterSegments).where(eq(chapterSegments.novelId, filters.novelId)).all()
    const segmentIdsByChapter = new Map<number, Set<number>>()
    segmentRows.forEach((segment) => {
      const current = segmentIdsByChapter.get(segment.chapterId) || new Set<number>()
      current.add(segment.id)
      segmentIdsByChapter.set(segment.chapterId, current)
    })
    return events.filter((event) => isEventLinkedToChapter(event, chapter, chapterNumById, segmentIdsByChapter))
  }
  if (filters.partId) {
    return events.filter((event) => event.partId === filters.partId)
  }
  if (filters.volumeId) {
    return events.filter((event) => event.volumeId === filters.volumeId)
  }
  return events
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 100) {
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

function buildTimelineWhere(filters: TimelineQueryFilters) {
  const db = getDb()
  const whereClauses = ['e.novel_id = ?']
  const params: Array<number | string> = [filters.novelId]
  let joinSql = ''

  if (filters.status) {
    whereClauses.push('e.status = ?')
    params.push(filters.status)
  }

  if (filters.eventType) {
    whereClauses.push('e.event_type = ?')
    params.push(filters.eventType)
  }

  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
  if (keyword) {
    const like = `%${keyword}%`
    whereClauses.push(`
      (
        e.event_title LIKE ?
        OR e.time_label LIKE ?
        OR COALESCE(e.event_summary, '') LIKE ?
        OR COALESCE(e.event_result, '') LIKE ?
        OR COALESCE(e.notes, '') LIKE ?
      )
    `)
    params.push(like, like, like, like, like)
  }

  if (filters.volumeId) {
    whereClauses.push('e.volume_id = ?')
    params.push(filters.volumeId)
  }

  if (filters.partId) {
    whereClauses.push('e.part_id = ?')
    params.push(filters.partId)
  }

  if (filters.segmentId) {
    whereClauses.push('e.segment_id = ?')
    params.push(filters.segmentId)
  }

  if (filters.chapterId) {
    const chapter = db.select().from(chapters).where(eq(chapters.id, filters.chapterId)).all()[0]
    if (!chapter) {
      return {
        empty: true,
        joinSql: '',
        whereSql: '1 = 0',
        params,
      }
    }

    joinSql = `
      LEFT JOIN chapters cs ON cs.id = e.chapter_start_id
      LEFT JOIN chapters ce ON ce.id = e.chapter_end_id
    `
    whereClauses.push(`
      (
        e.segment_id IN (SELECT s.id FROM chapter_segments s WHERE s.chapter_id = ?)
        OR e.chapter_start_id = ?
        OR e.chapter_end_id = ?
        OR (cs.chapter_num IS NOT NULL AND ce.chapter_num IS NOT NULL AND ? BETWEEN cs.chapter_num AND ce.chapter_num)
        OR (cs.chapter_num IS NOT NULL AND ce.chapter_num IS NULL AND ? = cs.chapter_num)
        OR (ce.chapter_num IS NOT NULL AND cs.chapter_num IS NULL AND ? = ce.chapter_num)
      )
    `)
    params.push(chapter.id, chapter.id, chapter.id, chapter.chapterNum, chapter.chapterNum, chapter.chapterNum)
  }

  return {
    empty: false,
    joinSql,
    whereSql: whereClauses.join(' AND '),
    params,
  }
}

const TIMELINE_SELECT_SQL = `
  SELECT
    e.id AS id,
    e.novel_id AS novelId,
    e.sort_order AS sortOrder,
    e.event_title AS eventTitle,
    e.event_summary AS eventSummary,
    e.time_mode AS timeMode,
    e.time_label AS timeLabel,
    e.time_sort_value AS timeSortValue,
    e.time_precision AS timePrecision,
    e.is_major_event AS isMajorEvent,
    e.event_type AS eventType,
    e.arc_id AS arcId,
    e.volume_id AS volumeId,
    e.part_id AS partId,
    e.chapter_start_id AS chapterStartId,
    e.chapter_end_id AS chapterEndId,
    e.segment_id AS segmentId,
    e.location_map_id AS locationMapId,
    e.present_character_ids_json AS presentCharacterIdsJson,
    e.affected_character_ids_json AS affectedCharacterIdsJson,
    e.protagonist_present AS protagonistPresent,
    e.protagonist_action AS protagonistAction,
    e.event_cause AS eventCause,
    e.event_process AS eventProcess,
    e.event_result AS eventResult,
    e.linked_item_ids_json AS linkedItemIdsJson,
    e.direct_consequences_json AS directConsequencesJson,
    e.open_threads_json AS openThreadsJson,
    e.notes AS notes,
    e.anchor_invalid AS anchorInvalid,
    e.status AS status,
    e.created_at AS createdAt,
    e.updated_at AS updatedAt
  FROM timeline_events e
`

export function queryTimelineEvents(filters: TimelineQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 100)
  const query = buildTimelineWhere(filters)
  if (query.empty) {
    return buildPagedResult([], paging.page, paging.pageSize, 0)
  }

  const sortBy = filters.sortBy === 'createdAt' ? 'e.created_at' : 'e.time_sort_value'
  const sortDirection = filters.sortDirection === 'desc' ? 'DESC' : 'ASC'
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM timeline_events e
    ${query.joinSql}
    WHERE ${query.whereSql}
  `).get(...query.params) as { total?: number } | undefined

  const rows = sqlite.prepare(`
    ${TIMELINE_SELECT_SQL}
    ${query.joinSql}
    WHERE ${query.whereSql}
    ORDER BY ${sortBy} ${sortDirection}, e.sort_order ASC, e.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map((row) => ({
    ...row,
    id: Number(row.id),
    novelId: Number(row.novelId),
    sortOrder: Number(row.sortOrder || 0),
    timeSortValue: Number(row.timeSortValue || 0),
    isMajorEvent: Number(row.isMajorEvent || 0),
    arcId: row.arcId == null ? undefined : Number(row.arcId),
    volumeId: row.volumeId == null ? undefined : Number(row.volumeId),
    partId: row.partId == null ? undefined : Number(row.partId),
    chapterStartId: row.chapterStartId == null ? undefined : Number(row.chapterStartId),
    chapterEndId: row.chapterEndId == null ? undefined : Number(row.chapterEndId),
    segmentId: row.segmentId == null ? undefined : Number(row.segmentId),
    locationMapId: row.locationMapId == null ? undefined : Number(row.locationMapId),
    protagonistPresent: Number(row.protagonistPresent || 0),
    anchorInvalid: Number(row.anchorInvalid || 0),
  }))

  return buildPagedResult(items, paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function searchTimelineEvents(novelId: number, keyword = '', limit = 20) {
  return queryTimelineEvents({
    novelId,
    keyword,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
    sortBy: 'timeSortValue',
    sortDirection: 'asc',
  }).items
}

export function listLinkedTimelineEventsPage(filters: TimelineAnchorFilters, page?: number, pageSize?: number) {
  return queryTimelineEvents({
    ...filters,
    page,
    pageSize: pageSize || 12,
    sortBy: 'timeSortValue',
    sortDirection: 'asc',
  })
}

export function getTimelineStats(filters: TimelineQueryFilters) {
  const sqlite = getSqlite()
  const query = buildTimelineWhere(filters)
  if (query.empty) {
    return {
      total: 0,
      majorCount: 0,
      resolvedCount: 0,
      openThreadCount: 0,
    }
  }

  const rows = sqlite.prepare(`
    SELECT
      e.is_major_event AS isMajorEvent,
      e.status AS status,
      e.open_threads_json AS openThreadsJson
    FROM timeline_events e
    ${query.joinSql}
    WHERE ${query.whereSql}
  `).all(...query.params) as Array<Record<string, unknown>>

  return rows.reduce<TimelineStatsAccumulator>((result, row) => {
    result.total += 1
    if (Number(row.isMajorEvent || 0)) result.majorCount += 1
    if (row.status === 'resolved') result.resolvedCount += 1
    result.openThreadCount += parseJsonStringArray((row.openThreadsJson as string | undefined) || '').length
    return result
  }, {
    total: 0,
    majorCount: 0,
    resolvedCount: 0,
    openThreadCount: 0,
  })
}

export function getTimelineFilterOptions(novelId: number) {
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT DISTINCT event_type AS eventType
    FROM timeline_events
    WHERE novel_id = ?
      AND event_type IS NOT NULL
      AND TRIM(event_type) <> ''
    ORDER BY event_type ASC
  `).all(novelId) as Array<{ eventType?: string | null }>

  return {
    eventTypes: rows
      .map((row) => asText(row.eventType))
      .filter(Boolean),
  }
}

export function markTimelineEventsSegmentAnchorInvalid(segmentId: number) {
  const db = getDb()
  db.update(timelineEvents).set({
    segmentId: null,
    anchorInvalid: 1,
    updatedAt: new Date().toISOString(),
  }).where(eq(timelineEvents.segmentId, segmentId)).run()
}

export function syncTimelineStructureAnchors(novelId: number) {
  const db = getDb()
  const rows = listTimelineEvents(novelId)
  rows.forEach((row) => {
    const next = resolveTimelineAnchorState(novelId, row)
    if (
      next.volumeId === (row.volumeId ?? null)
      && next.partId === (row.partId ?? null)
      && next.chapterStartId === (row.chapterStartId ?? null)
      && next.chapterEndId === (row.chapterEndId ?? null)
      && next.segmentId === (row.segmentId ?? null)
      && next.anchorInvalid === (row.anchorInvalid ?? 0)
    ) {
      return
    }

    db.update(timelineEvents).set({
      ...next,
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, row.id)).run()
  })
}

export function createTimelineEvent(
  novelId: number,
  data: Partial<typeof timelineEvents.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const nextSortOrder = typeof data.sortOrder === 'number' ? data.sortOrder : getNextSortOrder(novelId)
  const mutation = buildTimelineMutation(novelId, data)
  const typedRefsJson = deriveTimelineTypedRefsJson({
    typedRefsJson: typeof data.typedRefsJson === 'string' ? data.typedRefsJson : undefined,
    presentCharacterIdsJson: typeof data.presentCharacterIdsJson === 'string' ? data.presentCharacterIdsJson : undefined,
    affectedCharacterIdsJson: typeof data.affectedCharacterIdsJson === 'string' ? data.affectedCharacterIdsJson : undefined,
    linkedItemIdsJson: typeof data.linkedItemIdsJson === 'string' ? data.linkedItemIdsJson : undefined,
    openThreadsJson: typeof data.openThreadsJson === 'string' ? data.openThreadsJson : undefined,
  })
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
    ...(typedRefsJson ? { typedRefsJson } : {}),
    directConsequencesJson: data.directConsequencesJson || '[]',
    openThreadsJson: data.openThreadsJson || '[]',
    protagonistPresent: typeof data.protagonistPresent === 'number' ? data.protagonistPresent : 0,
    isMajorEvent: typeof data.isMajorEvent === 'number' ? data.isMajorEvent : 1,
    status: normalizeStatus(data.status),
    ...sanitizeTimelinePayload(data),
    ...mutation,
  }).run()
  const id = Number(result.lastInsertRowid)
  syncTimelineEventItemLinks(id)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Timeline events changed')
    recordAssetChangeEvent({
      novelId,
      assetType: 'timeline',
      assetId: id,
      assetLabel: data.eventTitle || '未命名事件',
      operation: 'create',
      changeReason: 'Timeline events changed',
      impactLevel: 'high',
      triggeredBy: 'timeline.service',
      payload: data,
    })
  }
  return id
}

export function updateTimelineEvent(
  id: number,
  data: Partial<typeof timelineEvents.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const current = getTimelineEvent(id)
  if (!current) return
  const db = getDb()
  const shouldRefreshTypedRefs = (
    hasOwn(data, 'presentCharacterIdsJson')
    || hasOwn(data, 'affectedCharacterIdsJson')
    || hasOwn(data, 'linkedItemIdsJson')
    || hasOwn(data, 'openThreadsJson')
  )
  const shouldWriteTypedRefs = shouldRefreshTypedRefs || typeof data.typedRefsJson === 'string'
  const typedRefsJson = deriveTimelineTypedRefsJson({
    typedRefsJson: typeof data.typedRefsJson === 'string'
      ? data.typedRefsJson
      : shouldRefreshTypedRefs
        ? undefined
        : current.typedRefsJson,
    presentCharacterIdsJson: typeof data.presentCharacterIdsJson === 'string' ? data.presentCharacterIdsJson : current.presentCharacterIdsJson,
    affectedCharacterIdsJson: typeof data.affectedCharacterIdsJson === 'string' ? data.affectedCharacterIdsJson : current.affectedCharacterIdsJson,
    linkedItemIdsJson: typeof data.linkedItemIdsJson === 'string' ? data.linkedItemIdsJson : current.linkedItemIdsJson,
    openThreadsJson: typeof data.openThreadsJson === 'string' ? data.openThreadsJson : current.openThreadsJson,
  })
  db.update(timelineEvents).set({
    ...sanitizeTimelinePayload(data),
    ...(shouldWriteTypedRefs ? { typedRefsJson: typedRefsJson ?? null } : typedRefsJson ? { typedRefsJson } : {}),
    ...buildTimelineMutation(current.novelId, data, current),
    updatedAt: new Date().toISOString(),
  }).where(eq(timelineEvents.id, id)).run()
  syncTimelineEventItemLinks(id)
  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Timeline events changed')
    recordAssetChangeEvent({
      novelId: current.novelId,
      assetType: 'timeline',
      assetId: id,
      assetLabel: (typeof data.eventTitle === 'string' && data.eventTitle.trim()) ? data.eventTitle.trim() : current.eventTitle,
      operation: 'update',
      changeReason: 'Timeline events changed',
      impactLevel: 'high',
      triggeredBy: 'timeline.service',
      payload: data,
    })
  }
}

export function deleteTimelineEvent(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = getTimelineEvent(id)
  removeTimelineEventFromItems(id)
  db.delete(timelineEvents).where(eq(timelineEvents.id, id)).run()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Timeline events changed')
    recordAssetChangeEvent({
      novelId: current.novelId,
      assetType: 'timeline',
      assetId: id,
      assetLabel: current.eventTitle,
      operation: 'delete',
      changeReason: 'Timeline events changed',
      impactLevel: 'high',
      triggeredBy: 'timeline.service',
    })
  }
}

export function batchUpdateTimelineEvents(
  ids: number[],
  data: Partial<Pick<typeof timelineEvents.$inferInsert, 'status' | 'isMajorEvent'>>,
) {
  const eventIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (eventIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(timelineEvents)
    .where(inArray(timelineEvents.id, eventIds))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    updateTimelineEvent(row.id, {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.isMajorEvent !== undefined ? { isMajorEvent: data.isMajorEvent } : {}),
    }, { skipContextTracking: true })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'timeline',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_update',
    summary: `批量更新 ${rows.length} 条时间轴事件`,
    batchKey: buildBatchKey('timeline-batch-update'),
    before: rows,
    after: data,
    undoPayload: {
      kind: 'timeline.batch_update',
      novelId: rows[0].novelId,
      events: rows,
    },
  })

  markNovelContextChanged(rows[0].novelId, 'Timeline events changed')
  return rows.length
}

export function batchDeleteTimelineEvents(ids: number[]) {
  const eventIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (eventIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(timelineEvents)
    .where(inArray(timelineEvents.id, eventIds))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    deleteTimelineEvent(row.id, { skipContextTracking: true })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'timeline',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_delete',
    summary: `批量删除 ${rows.length} 条时间轴事件`,
    batchKey: buildBatchKey('timeline-batch-delete'),
    before: rows,
    after: [],
    undoPayload: {
      kind: 'timeline.batch_delete',
      novelId: rows[0].novelId,
      events: rows,
    },
  })

  markNovelContextChanged(rows[0].novelId, 'Timeline events changed')
  return rows.length
}

export function clearTimelineByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()

  itemRows.forEach((item) => {
    db.update(storyItems).set({
      linkedTimelineEventIdsJson: JSON.stringify([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(storyItems.id, item.id)).run()
  })

  db.delete(timelineEvents).where(eq(timelineEvents.novelId, novelId)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Timeline events changed')
  }
}

export async function generateTimelineBatchChunk(
  novelId: number,
  options: TimelineGenerateOptions = {},
  runtime: {
    parentTaskId?: number
    sender?: WebContents
    batchIndex?: number
    totalBatches?: number
  } = {},
): Promise<TimelineBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const defaultPrecision = rules.timelineConfig.precisionOptions[0] || '阶段'
  const historyEntityType = 'timeline'
  const historyTaskType = 'timeline_generate_batch'
  const requestedCount = Math.max(1, Math.min(options.count || 10, 24))
  let resultPayload: TimelineBatchChunkResult | null = null

  const existingEvents = listTimelineEvents(novelId)
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const timelineRulesSummary = buildTimelineConfigSummary(rules)
  const arcSummary = buildArcSummary(arcRows)
  const characterSummary = buildCharacterSummary(characterRows)
  const locationSummary = buildLocationSummary(mapRows)
  const itemSummary = buildItemSummary(itemRows)
  const existingEventSummary = buildExistingEventSummary(existingEvents)
  const focusSummary = [
    options.focus ? `额外聚焦：${options.focus}` : '',
    `本批要求：只生成 ${requestedCount} 个新事件，避免重复已有时间轴内容。`,
  ].filter(Boolean).join('\n')
  const reviewContext = buildTimelineReviewContext({
    profile,
    storyCore: storyCoreSummary,
    timelineRules: timelineRulesSummary,
    arcSummary,
    characterSummary,
    locationSummary,
    itemSummary,
    existingEvents: existingEventSummary,
    focus: focusSummary,
  })
  const prompt = buildTimelineEventsPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    background: [profile.background, focusSummary].filter(Boolean).join('\n'),
    storyGoal: profile.storyGoal,
    coreConflict: profile.coreConflict,
    mainPlot: profile.mainPlot,
    subPlots: profile.subPlots,
    ending: profile.ending,
    worldRulesSummary: [profile.worldRulesSummary, profile.endgameDesignSummary, storyCoreSummary].filter(Boolean).join('\n\n'),
    timelineRules: timelineRulesSummary,
    arcSummary,
    characterSummary,
    locationSummary,
    itemSummary,
    existingEvents: existingEventSummary,
    count: requestedCount,
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
  })

  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
    attemptNumber,
    rejectedDigests,
  })
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'generate_timeline',
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
      type: 'generate_timeline',
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
          targetType: 'timeline',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: result,
          schemaHint: timelineSchemaHint(requestedCount),
          reviewFocus: [
            '事件必须具备明确动机、因果和后果，不要只给标题和口号式概述。',
            '时间锚点、人物在场、地点与物品引用要与现有资产和时间规则相容。',
          ],
          rewriteConstraints: [
            '保持事件数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把数组改成长文。',
          ],
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批时间轴事件被审校拒收。`,
          }
          return resultPayload
        }
        let parsed: GeneratedTimelineEvent[]
        try {
          parsed = cleanAiValue(safeParseJson<GeneratedTimelineEvent[]>(quality.finalOutput))
        } catch (error) {
          markRejected(historyId)
          throw error
        }
        const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
        if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批时间轴事件与近期拒绝结果过于相近，已自动跳过。`,
          }
          return resultPayload
        }
        if (!Array.isArray(parsed)) {
          markRejected(historyId)
          throwUserFacingError('timeline.generatedArrayInvalid')
        }

        const startSortOrder = getNextSortOrder(novelId)
        const usedSignatures = new Set(
          existingEvents
            .map((event) => buildTimelineSignature(event))
            .filter(Boolean),
        )
        let acceptedInBatch = 0
        const createdIds: number[] = []
        const acceptedTitles: string[] = []

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
          const signature = buildTimelineSignature(payload)
          if (!signature || usedSignatures.has(signature)) return
          const id = createTimelineEvent(novelId, payload, { skipContextTracking: true })
          createdIds.push(id)
          usedSignatures.add(signature)
          acceptedInBatch += 1
          acceptedTitles.push(payload.eventTitle || `事件#${id}`)
        })

        if (acceptedInBatch === 0) {
          markRejected(historyId)
        }
        if (createdIds.length > 0) {
          markNovelContextChanged(novelId, 'Timeline events changed')
        }

        resultPayload = {
          ids: createdIds,
          warning: createdIds.length > 0
            ? summarizeAssetQualityWarnings(quality)
            : (summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批没有生成可用时间轴事件。`),
          batchDigest: acceptedTitles.slice(0, 4).join('、'),
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

export async function generateTimelineEvents(
  novelId: number,
  options: TimelineGenerateOptions = {},
): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const defaultPrecision = rules.timelineConfig.precisionOptions[0] || '阶段'
  const createdIds: number[] = []
  const historyEntityType = 'timeline'
  const historyTaskType = 'timeline_generate_batch'
  const totalCount = Math.min(Math.max(options.count || 10, 4), 24)
  const batchSize = Math.max(1, Math.min(totalCount, options.batchSize || Math.min(totalCount, 4), 6))
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const timelineRulesSummary = buildTimelineConfigSummary(rules)
  const arcSummary = buildArcSummary(arcRows)
  const characterSummary = buildCharacterSummary(characterRows)
  const locationSummary = buildLocationSummary(mapRows)
  const itemSummary = buildItemSummary(itemRows)

  for (let generatedCount = 0; generatedCount < totalCount; generatedCount += batchSize) {
    const currentBatchCount = Math.min(batchSize, totalCount - generatedCount)
    const existingEvents = listTimelineEvents(novelId)
    const existingEventSummary = buildExistingEventSummary(existingEvents)
    const focusSummary = [
      options.focus ? `额外聚焦：${options.focus}` : '',
      `本批要求：只生成 ${currentBatchCount} 个新事件，避免重复已有时间轴内容。`,
    ].filter(Boolean).join('\n')
    const reviewContext = buildTimelineReviewContext({
      profile,
      storyCore: storyCoreSummary,
      timelineRules: timelineRulesSummary,
      arcSummary,
      characterSummary,
      locationSummary,
      itemSummary,
      existingEvents: existingEventSummary,
      focus: focusSummary,
    })
    const prompt = buildTimelineEventsPrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      background: [profile.background, focusSummary].filter(Boolean).join('\n'),
      storyGoal: profile.storyGoal,
      coreConflict: profile.coreConflict,
      mainPlot: profile.mainPlot,
      subPlots: profile.subPlots,
      ending: profile.ending,
      worldRulesSummary: [profile.worldRulesSummary, profile.endgameDesignSummary, storyCoreSummary].filter(Boolean).join('\n\n'),
      timelineRules: timelineRulesSummary,
      arcSummary,
      characterSummary,
      locationSummary,
      itemSummary,
      existingEvents: existingEventSummary,
      count: currentBatchCount,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
    })

    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
      attemptNumber,
      rejectedDigests,
    })

    let acceptedBatch: GeneratedTimelineEvent[] | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'generate_timeline',
      novelId,
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'timeline',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          contextSummary: reviewContext,
          generatedOutput: rawOutput,
          schemaHint: timelineSchemaHint(currentBatchCount),
          reviewFocus: [
            '事件必须有明确因果链和落地后果，不能只给标题与空泛概述。',
            '时间规则、人物、地点、物品和章节锚点必须相容。',
          ],
          rewriteConstraints: [
            '保持事件数组长度不变。',
            '保持对象顺序和字段结构稳定。',
          ],
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        acceptedBatch = cleanAiValue(safeParseJson<GeneratedTimelineEvent[]>(quality.finalOutput))
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
    if (rejectedByQuality) {
      markRejected(historyId)
      continue
    }

    let parsed: GeneratedTimelineEvent[]
    try {
      parsed = acceptedBatch || cleanAiValue(safeParseJson<GeneratedTimelineEvent[]>(result))
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
      throwUserFacingError('timeline.generatedArrayInvalid')
    }

    const startSortOrder = getNextSortOrder(novelId)
    const usedSignatures = new Set(
      existingEvents
        .map((event) => buildTimelineSignature(event))
        .filter(Boolean),
    )
    let acceptedInBatch = 0

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
      const signature = buildTimelineSignature(payload)
      if (!signature || usedSignatures.has(signature)) return
      createdIds.push(createTimelineEvent(novelId, payload, { skipContextTracking: true }))
      usedSignatures.add(signature)
      acceptedInBatch += 1
    })

    if (acceptedInBatch === 0) {
      markRejected(historyId)
    }
  }

  if (createdIds.length > 0) {
    markNovelContextChanged(novelId, 'Timeline events changed')
  }

  return createdIds
}

export async function regenerateTimelineEvent(
  id: number,
  options: EntityRegenerateOptions = {},
): Promise<typeof timelineEvents.$inferSelect | null> {
  const current = getTimelineEvent(id)
  if (!current) return null

  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) return null

  const profile = await buildStoryProfile(current.novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, current.novelId)).all()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, current.novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, current.novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, current.novelId)).all()
  const defaultPrecision = rules.timelineConfig.precisionOptions[0] || '阶段'
  const mode = options.mode === 'replace' ? 'replace' : 'repair'
  const historyEntityType = 'timeline'
  const historyTaskType = 'timeline_regenerate'
  const attemptNumber = getAttemptCount(current.novelId, historyEntityType, current.id, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(current.novelId, historyEntityType, current.id, historyTaskType)
  const currentSignature = buildTimelineSignature(current)
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const timelineRulesSummary = buildTimelineConfigSummary(rules)
  const reviewContext = buildTimelineReviewContext({
    profile,
    storyCore: storyCoreSummary,
    timelineRules: timelineRulesSummary,
    arcSummary: buildArcSummary(arcRows),
    characterSummary: buildCharacterSummary(characterRows),
    locationSummary: buildLocationSummary(mapRows),
    itemSummary: buildItemSummary(itemRows),
    existingEvents: buildExistingEventSummary(listTimelineEvents(current.novelId).filter((event) => event.id !== current.id)),
    currentSummary: buildTimelineCurrentSummary(current),
    mode,
  })
  const messages = appendVariationMessage([{
    role: 'user',
    content: buildTimelineRepairPrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      background: profile.background,
      worldSummary: profile.worldRulesSummary,
      timelineRules: timelineRulesSummary,
      storyGoal: profile.storyGoal,
      coreConflict: profile.coreConflict,
      mainPlot: profile.mainPlot,
      ending: profile.ending,
      endgameDesignSummary: profile.endgameDesignSummary,
      arcSummary: buildArcSummary(arcRows),
      characterSummary: buildCharacterSummary(characterRows),
      locationSummary: buildLocationSummary(mapRows),
      itemSummary: buildItemSummary(itemRows),
      currentSummary: buildTimelineCurrentSummary(current),
      mode,
    }),
  }], {
    attemptNumber,
    rejectedDigests,
  })

  let acceptedCandidate: GeneratedTimelineEvent | null = null
  let rejectedByQuality = false
  const result = await runChatTask({
    type: 'generate_timeline',
    novelId: current.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'timeline',
    relatedEntityId: current.id,
    messages,
    onSuccess: async (rawOutput, taskId) => {
      const quality = await runAssetQualityLoop({
        targetType: 'timeline',
        novelId: current.novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'timeline',
        relatedEntityId: current.id,
        parentTaskId: taskId,
        contextSummary: reviewContext,
        generatedOutput: rawOutput,
        schemaHint: timelineSchemaHint(),
        reviewFocus: [
          '修复后的事件必须继续承担原节奏功能位，同时补齐因果、锚点和引用关系。',
          '避免空泛概述和与现有时间规则冲突的写法。',
        ],
        rewriteConstraints: [
          '保持单个时间轴事件 JSON 对象结构稳定。',
          '不要把事件卡改写成长文。',
        ],
      })
      if (quality.stage === 'rejected') {
        rejectedByQuality = true
        return quality
      }
      acceptedCandidate = cleanAiValue(safeParseJson<GeneratedTimelineEvent>(quality.finalOutput))
      return quality
    },
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)
  if (rejectedByQuality) {
    markRejected(historyId)
    return current
  }
  let parsed: GeneratedTimelineEvent
  try {
    parsed = acceptedCandidate || cleanAiValue(safeParseJson<GeneratedTimelineEvent>(result))
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
    defaultTimeMode: rules.timelineConfig.calendarType,
    defaultPrecision,
    sortOrder: current.sortOrder || 0,
    arcRows,
    chapterRows,
    characterRows,
    itemRows,
    mapRows,
  })
  const nextSignature = payload ? buildTimelineSignature(payload) : ''
  if (!payload || !payload.eventTitle || !nextSignature || nextSignature === currentSignature) {
    markRejected(historyId)
    return current
  }

  updateTimelineEvent(id, payload, { skipContextTracking: true })
  markNovelContextChanged(current.novelId, 'Timeline events changed')
  return getTimelineEvent(id)
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

