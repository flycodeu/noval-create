import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  novels,
} from '../database/schema'
import type {
  Chapter,
  Character,
  CharacterGraphPayload,
  CharacterLocationBinding,
  CharacterLocationBindingInput,
  CreativeStageContext,
  Faction,
  MapBoardLayoutNode,
  MapBoardLayoutNodeInput,
  MapBoardViewport,
  MapBoardViewportInput,
  NarrativeBoardQueryInput,
  NarrativeBoardSnapshot,
  NovelContextStatus,
  QualityDashboardData,
  StoryThread,
  Task,
  TimelineEvent,
  WorldMapItem,
} from '../../src/types'
import {
  filterWorldMapTreeByIds,
  isTimelineEventInChapterWindow,
  parseJsonNumberIds,
  parseJsonTokens,
  type NarrativeScope,
} from '../../src/shared/narrative-board'
import * as characterService from './character.service'
import * as chapterService from './chapter.service'
import * as creativeStageService from './creative-stage.service'
import * as factionService from './faction.service'
import * as mapService from './map.service'
import * as qualityDashboardService from './quality-dashboard.service'
import * as storyThreadService from './story-thread.service'
import * as taskService from './task.service'
import * as timelineService from './timeline.service'
import * as novelService from './novel.service'
import { throwUserFacingError } from '../utils/user-facing-error'

const DEFAULT_LAYOUT_KEY = 'default'
const DEFAULT_LAYERS: MapBoardViewport['activeLayers'] = ['regions', 'routes', 'events', 'people', 'factions']

type DbRow = Record<string, unknown>

function positiveId(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function normalizeLayoutKey(value?: string): string {
  const key = typeof value === 'string' ? value.trim() : ''
  return key ? key.slice(0, 80) : DEFAULT_LAYOUT_KEY
}

function normalizeLayers(value?: string[] | null): MapBoardViewport['activeLayers'] {
  if (!Array.isArray(value)) return [...DEFAULT_LAYERS]
  const allowed = new Set(DEFAULT_LAYERS)
  const layers = value.filter((layer): layer is MapBoardViewport['activeLayers'][number] => allowed.has(layer as MapBoardViewport['activeLayers'][number]))
  return layers.length > 0 ? [...new Set(layers)] : [...DEFAULT_LAYERS]
}

function parseObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseIds(raw?: string | null): number[] {
  return parseJsonNumberIds(raw)
}

function intersect<T>(values: Iterable<T>, set: Set<T>): boolean {
  for (const value of values) if (set.has(value)) return true
  return false
}

function mapBoardLayoutRow(row: DbRow): MapBoardLayoutNode {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    mapNodeId: Number(row.map_node_id),
    layoutKey: String(row.layout_key || DEFAULT_LAYOUT_KEY),
    x: Number(row.x || 0),
    y: Number(row.y || 0),
    width: Number(row.width || 260),
    height: Number(row.height || 150),
    layerKey: String(row.layer_key || 'regions'),
    visible: Number(row.visible ?? 1),
    zIndex: Number(row.z_index || 0),
    layoutVersion: Number(row.layout_version || 1),
    contextVersion: Number(row.context_version || 1),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function mapBindingRow(row: DbRow): CharacterLocationBinding {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    characterId: Number(row.character_id),
    mapNodeId: Number(row.map_node_id),
    bindingType: String(row.binding_type || 'presence'),
    chapterStartId: row.chapter_start_id == null ? null : Number(row.chapter_start_id),
    chapterEndId: row.chapter_end_id == null ? null : Number(row.chapter_end_id),
    sourceType: String(row.source_type || 'manual'),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    confidence: Number(row.confidence ?? 1),
    isCanonical: Number(row.is_canonical ?? 0),
    notes: row.notes == null ? null : String(row.notes),
    contextVersion: Number(row.context_version || 1),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function mapViewportRow(row: DbRow): MapBoardViewport {
  let activeLayers: string[] = []
  try {
    const parsed = JSON.parse(String(row.active_layers_json || '[]')) as unknown
    if (Array.isArray(parsed)) activeLayers = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    activeLayers = []
  }
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    layoutKey: String(row.layout_key || DEFAULT_LAYOUT_KEY),
    centerX: Number(row.center_x || 0),
    centerY: Number(row.center_y || 0),
    zoom: boundedNumber(row.zoom, 1, 0.12, 2.5),
    activeLayers: normalizeLayers(activeLayers),
    layoutVersion: Number(row.layout_version || 1),
    contextVersion: Number(row.context_version || 1),
    createdAt: row.created_at == null ? undefined : String(row.created_at),
    updatedAt: row.updated_at == null ? undefined : String(row.updated_at),
  }
}

function getNovelContextVersion(novelId: number): number {
  const row = getDb().select({ contextVersion: novels.contextVersion })
    .from(novels)
    .where(eq(novels.id, novelId))
    .all()[0]
  return Number(row?.contextVersion || 1)
}

function getMapLayoutRows(novelId: number, layoutKey = DEFAULT_LAYOUT_KEY, mapNodeIds?: number[]): MapBoardLayoutNode[] {
  const sqlite = getSqlite()
  const normalizedKey = normalizeLayoutKey(layoutKey)
  const rows = sqlite.prepare(`
    SELECT * FROM narrative_map_layout_nodes
    WHERE novel_id = ? AND layout_key = ?
    ORDER BY z_index ASC, map_node_id ASC
  `).all(novelId, normalizedKey) as DbRow[]
  const allowed = mapNodeIds !== undefined ? new Set(mapNodeIds) : null
  return rows.map(mapBoardLayoutRow).filter((row) => !allowed || allowed.has(row.mapNodeId))
}

function ensureLayoutRows(novelId: number, layoutKey: string, mapNodeIds: number[]): void {
  if (mapNodeIds.length === 0) return
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT id, map_node_id FROM narrative_map_layout_nodes
    WHERE novel_id = ? AND layout_key = ?
  `).all(novelId, layoutKey) as Array<{ id: number; map_node_id: number }>
  const existing = new Set(rows.map((row) => Number(row.map_node_id)))
  const mapRows = sqlite.prepare(`
    SELECT id, level, sort_order FROM world_map
    WHERE novel_id = ? AND id IN (${mapNodeIds.map(() => '?').join(',')})
    ORDER BY level ASC, sort_order ASC, id ASC
  `).all(novelId, ...mapNodeIds) as Array<{ id: number; level: number; sort_order: number }>
  const version = getNovelContextVersion(novelId)
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO narrative_map_layout_nodes
      (novel_id, map_node_id, layout_key, x, y, width, height, layer_key, visible, z_index, layout_version, context_version)
    VALUES (?, ?, ?, ?, ?, 260, 150, 'regions', 1, ?, 1, ?)
  `)
  const transaction = sqlite.transaction(() => {
    mapRows.forEach((row, index) => {
      if (existing.has(Number(row.id))) return
      const column = index % 4
      const line = Math.floor(index / 4)
      const levelOffset = Math.max(0, Number(row.level || 1) - 1) * 34
      insert.run(novelId, Number(row.id), layoutKey, column * 340 + levelOffset, line * 220 + levelOffset, index, version)
    })
  })
  transaction()
}

function getOrCreateViewport(novelId: number, layoutKey: string): MapBoardViewport {
  const sqlite = getSqlite()
  const row = sqlite.prepare(`
    SELECT * FROM narrative_map_viewports WHERE novel_id = ? AND layout_key = ? LIMIT 1
  `).get(novelId, layoutKey) as DbRow | undefined
  if (row) return mapViewportRow(row)
  const version = getNovelContextVersion(novelId)
  sqlite.prepare(`
    INSERT OR IGNORE INTO narrative_map_viewports
      (novel_id, layout_key, center_x, center_y, zoom, active_layers_json, layout_version, context_version)
    VALUES (?, ?, 0, 0, 1, ?, 1, ?)
  `).run(novelId, layoutKey, JSON.stringify(DEFAULT_LAYERS), version)
  const created = sqlite.prepare(`
    SELECT * FROM narrative_map_viewports WHERE novel_id = ? AND layout_key = ? LIMIT 1
  `).get(novelId, layoutKey) as DbRow | undefined
  if (!created) throwUserFacingError('narrativeBoard.viewportCreateFailed')
  return mapViewportRow(created)
}

function resolveStageContext(novelId: number, stageId?: number): CreativeStageContext | null {
  if (!stageId) return null
  // A missing/archived stage is a hard scope miss. Let the domain error reach
  // the IPC boundary so callers cannot silently fall back to the whole novel.
  return creativeStageService.getCreativeStageContext(novelId, stageId)
}

function normalizeScope(input: NarrativeBoardQueryInput): NarrativeBoardQueryInput {
  const novelId = positiveId(input?.novelId)
  if (!novelId) throw new Error('narrative board requires a valid novelId')
  const chapterStart = positiveId(input.chapterStart)
  const chapterEnd = positiveId(input.chapterEnd)
  return {
    ...input,
    novelId,
    stageId: positiveId(input.stageId),
    volumeId: positiveId(input.volumeId),
    chapterStart,
    chapterEnd: chapterStart && chapterEnd ? Math.max(chapterStart, chapterEnd) : chapterEnd,
    storyThreadIds: Array.isArray(input.storyThreadIds) ? [...new Set(input.storyThreadIds.map(positiveId).filter((value): value is number => typeof value === 'number'))] : undefined,
    timelineEventId: positiveId(input.timelineEventId),
    taskId: positiveId(input.taskId),
    mapNodeId: positiveId(input.mapNodeId),
    characterIds: Array.isArray(input.characterIds) ? [...new Set(input.characterIds.map(positiveId).filter((value): value is number => typeof value === 'number'))] : undefined,
    factionIds: Array.isArray(input.factionIds) ? [...new Set(input.factionIds.map(positiveId).filter((value): value is number => typeof value === 'number'))] : undefined,
    keyword: typeof input.keyword === 'string' ? input.keyword.trim().slice(0, 120) : undefined,
    layoutKey: normalizeLayoutKey(input.layoutKey),
    strictAnchors: input.strictAnchors !== false,
  }
}

function isThreadInChapterWindow(thread: StoryThread, start?: number, end?: number): boolean {
  if (!start && !end) return true
  const rangeStart = start || Number.NEGATIVE_INFINITY
  const rangeEnd = end || Number.POSITIVE_INFINITY
  const threadStart = thread.startChapter ?? thread.plantedChapter ?? thread.lastReferencedChapter
  const threadEnd = thread.resolvedChapter ?? thread.targetPayoffChapter ?? thread.lastReferencedChapter ?? threadStart
  if (typeof threadStart !== 'number' && typeof threadEnd !== 'number') return false
  return (threadStart ?? threadEnd ?? 0) <= rangeEnd && (threadEnd ?? threadStart ?? 0) >= rangeStart
}

function isKeywordMatch(values: Array<string | null | undefined>, keyword?: string): boolean {
  const normalized = keyword?.trim().toLocaleLowerCase()
  if (!normalized) return true
  return values.filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalized)
}

function eventThreadIds(event: TimelineEvent, threads: StoryThread[]): number[] {
  const tokens = parseJsonTokens(event.openThreadsJson)
  return threads
    .filter((thread) => tokens.some((token) => token === thread.id || (typeof token === 'string' && token === thread.title)))
    .map((thread) => thread.id)
}

function taskContainsNumber(raw: string | undefined, keys: string[], values: Set<number>): boolean {
  const parsed = parseObject(raw)
  return keys.some((key) => {
    const value = parsed[key]
    return (typeof value === 'number' && values.has(value))
      || (Array.isArray(value) && value.some((item) => typeof item === 'number' && values.has(item)))
  })
}

const TASK_STAGE_KEYS = ['stageId', 'creativeStageId']
const TASK_CHAPTER_ID_KEYS = ['chapterId', 'chapterIds']
const TASK_CHAPTER_NUMBER_KEYS = ['chapterNum', 'chapterNumbers']

function taskEntityMatches(task: Task, entityType: string, ids: Set<number>): boolean {
  const entityId = positiveId(task.relatedEntityId)
  return task.relatedEntityType === entityType && entityId != null && ids.has(entityId)
}

function taskPayloadMatches(task: Task, keys: string[], values: Set<number>): boolean {
  return taskContainsNumber(task.controlJson, keys, values) || taskContainsNumber(task.inputJson, keys, values)
}

function taskPayloadContainsRange(raw: string | undefined, keys: string[], rangeStart: number, rangeEnd: number): boolean {
  const parsed = parseObject(raw)
  return keys.some((key) => {
    const value = parsed[key]
    const values = Array.isArray(value) ? value : [value]
    return values.some((item) => typeof item === 'number' && item >= rangeStart && item <= rangeEnd)
  })
}

function taskMatchesStageScope(task: Task, scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, mapIds: Set<number>, characterIds: Set<number>): boolean | undefined {
  if (!scope.stageId) return undefined
  const stageIds = new Set([scope.stageId])
  if (taskPayloadMatches(task, TASK_STAGE_KEYS, stageIds)) return true
  if (taskEntityMatches(task, 'map', mapIds) || taskEntityMatches(task, 'character', characterIds)) return true
  const hasStageWindow = stageContext?.stage.chapterStart != null || stageContext?.stage.chapterEnd != null
  return hasStageWindow ? undefined : false
}

function taskMatchesChapterScope(task: Task, start: number | undefined, end: number | undefined, chapterNumbers: Set<number>, chapterIds: Set<number>): boolean | undefined {
  if (start == null && end == null) return undefined
  const rangeStart = start ?? Number.NEGATIVE_INFINITY
  const rangeEnd = end ?? Number.POSITIVE_INFINITY
  const scopedChapterNumbers = new Set([...chapterNumbers].filter((number) => number >= rangeStart && number <= rangeEnd))
  if (taskPayloadMatches(task, TASK_CHAPTER_ID_KEYS, chapterIds)) return true
  if (taskPayloadMatches(task, TASK_CHAPTER_NUMBER_KEYS, scopedChapterNumbers)) return true
  if (taskPayloadContainsRange(task.inputJson, ['chapterStart', 'chapterEnd'], rangeStart, rangeEnd) || taskPayloadContainsRange(task.controlJson, ['chapterStart', 'chapterEnd'], rangeStart, rangeEnd)) return true
  return taskEntityMatches(task, 'chapter', chapterIds)
}

function taskMatchesScope(task: Task, scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, mapIds: Set<number>, characterIds: Set<number>, chapterNumbers: Set<number>, chapterIds: Set<number>): boolean {
  if (scope.taskId && task.id !== scope.taskId) return false
  const stageMatch = taskMatchesStageScope(task, scope, stageContext, mapIds, characterIds)
  if (stageMatch !== undefined) return stageMatch
  const chapterStart = scope.chapterStart ?? (scope.stageId ? stageContext?.stage.chapterStart ?? undefined : undefined)
  const chapterEnd = scope.chapterEnd ?? (scope.stageId ? stageContext?.stage.chapterEnd ?? undefined : undefined)
  const chapterMatch = taskMatchesChapterScope(task, chapterStart, chapterEnd, chapterNumbers, chapterIds)
  return chapterMatch !== false
}

function filterTasks(tasks: Task[], scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, mapIds: Set<number>, characterIds: Set<number>, chapters: Array<{ id: number; chapterNum: number }>, mapScopeIds?: Set<number> | null): Task[] {
  const start = scope.chapterStart ?? (scope.stageId ? stageContext?.stage.chapterStart ?? undefined : undefined)
  const end = scope.chapterEnd ?? (scope.stageId ? stageContext?.stage.chapterEnd ?? undefined : undefined)
  const scopedChapters = chapters.filter((chapter) => (start == null || chapter.chapterNum >= start) && (end == null || chapter.chapterNum <= end))
  const chapterIds = new Set(scopedChapters.map((chapter) => chapter.id))
  const chapterNumbers = new Set(scopedChapters.map((chapter) => chapter.chapterNum))
  return tasks
    .filter((task) => !mapScopeIds || task.relatedEntityType !== 'map' || (typeof task.relatedEntityId === 'number' && mapScopeIds.has(task.relatedEntityId)))
    .filter((task) => taskMatchesScope(task, scope, stageContext, mapIds, characterIds, chapterNumbers, chapterIds))
    .filter((task) => isKeywordMatch([task.type, task.status, task.errorMessage, task.relatedEntityType], scope.keyword))
}

function filterBindings(bindings: CharacterLocationBinding[], scope: NarrativeBoardQueryInput, chaptersById: Map<number, number>, activeMapIds: Set<number>, activeCharacterIds: Set<number>): CharacterLocationBinding[] {
  const start = scope.chapterStart
  const end = scope.chapterEnd
  return bindings.filter((binding) => {
    if (scope.characterIds?.length && !scope.characterIds.includes(binding.characterId)) return false
    if (scope.mapNodeId && binding.mapNodeId !== scope.mapNodeId) return false
    if (scope.stageId && (activeMapIds.size > 0 || activeCharacterIds.size > 0) && !activeMapIds.has(binding.mapNodeId) && !activeCharacterIds.has(binding.characterId)) return false
    if (!start && !end) return true
    const bindingStart = binding.chapterStartId ? chaptersById.get(binding.chapterStartId) : undefined
    const bindingEnd = binding.chapterEndId ? chaptersById.get(binding.chapterEndId) : undefined
    if (bindingStart == null && bindingEnd == null) return binding.sourceType === 'manual' || binding.sourceType === 'legacy_json'
    const rangeStart = start || Number.NEGATIVE_INFINITY
    const rangeEnd = end || Number.POSITIVE_INFINITY
    return (bindingStart ?? bindingEnd ?? 0) <= rangeEnd && (bindingEnd ?? bindingStart ?? 0) >= rangeStart
  })
}

function getBindings(scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, chapters: Array<{ id: number; chapterNum: number }>, mapScopeIds?: Set<number> | null): CharacterLocationBinding[] {
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT * FROM character_location_binding
    WHERE novel_id = ?
    ORDER BY is_canonical DESC, confidence DESC, id ASC
  `).all(scope.novelId) as DbRow[]
  const chaptersById = new Map(chapters.map((chapter) => [chapter.id, chapter.chapterNum]))
  const activeMapIds = new Set(stageContext?.activeMapIds || [])
  const activeCharacterIds = new Set(stageContext?.activeCharacterIds || [])
  const scoped = {
    ...scope,
    chapterStart: scope.chapterStart ?? stageContext?.stage.chapterStart ?? undefined,
    chapterEnd: scope.chapterEnd ?? stageContext?.stage.chapterEnd ?? undefined,
  }
  const bindings = filterBindings(rows.map(mapBindingRow), scoped, chaptersById, activeMapIds, activeCharacterIds)
  return mapScopeIds ? bindings.filter((binding) => mapScopeIds.has(binding.mapNodeId)) : bindings
}

function filterCharacters(characters: Character[], scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, factions: Faction[]): Character[] {
  const activeIds = stageContext ? new Set(stageContext.activeCharacterIds) : null
  const factionIds = scope.factionIds?.length ? new Set(scope.factionIds) : null
  const factionNames = factionIds
    ? new Set(factions.filter((faction) => factionIds.has(faction.id)).map((faction) => faction.name))
    : null
  return characters
    .filter((character) => !activeIds || activeIds.has(character.id))
    .filter((character) => !factionIds || parseJsonTokens(character.campFactionIdsJson).some((token) => typeof token === 'number' ? factionIds.has(token) : factionNames?.has(token)))
    .filter((character) => isKeywordMatch([character.fullName, character.occupation, character.goals, character.background, character.socialIdentity], scope.keyword))
}

function filterEvents(events: TimelineEvent[], scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, chapters: Array<{ id: number; chapterNum: number }>, mapIds: Set<number>, characterIds: Set<number>, threads: StoryThread[], mapScopeIds?: Set<number> | null): TimelineEvent[] {
  const chapterNumbers = new Map(chapters.map((chapter) => [chapter.id, chapter.chapterNum]))
  const narrativeScope: Pick<NarrativeScope, 'chapterStart' | 'chapterEnd'> = {
    chapterStart: scope.chapterStart ?? stageContext?.stage.chapterStart ?? undefined,
    chapterEnd: scope.chapterEnd ?? stageContext?.stage.chapterEnd ?? undefined,
  }
  return events
    .filter((event) => scope.timelineEventId ? event.id === scope.timelineEventId : true)
    .filter((event) => !mapScopeIds || (typeof event.locationMapId === 'number' && mapScopeIds.has(event.locationMapId)))
    .filter((event) => isTimelineEventInChapterWindow(event, narrativeScope, chapterNumbers, scope.strictAnchors !== false))
    .filter((event) => {
      if (!stageContext) return true
      const participantIds = parseIds(event.presentCharacterIdsJson).concat(parseIds(event.affectedCharacterIdsJson))
      const linkedToStage = (typeof event.locationMapId === 'number' && mapIds.has(event.locationMapId)) || intersect(participantIds, characterIds)
      const hasStageRange = narrativeScope.chapterStart !== undefined || narrativeScope.chapterEnd !== undefined
      return linkedToStage || hasStageRange
    })
    .filter((event) => !scope.storyThreadIds?.length || intersect(eventThreadIds(event, threads), new Set(scope.storyThreadIds)))
    .filter((event) => isKeywordMatch([event.eventTitle, event.eventSummary, event.eventResult, event.timeLabel, event.notes], scope.keyword))
    .sort((left, right) => left.timeSortValue - right.timeSortValue || left.sortOrder - right.sortOrder || left.id - right.id)
}

function filterThreads(threads: StoryThread[], scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null, characterIds: Set<number>): StoryThread[] {
  return threads
    .filter((thread) => !scope.storyThreadIds?.length || scope.storyThreadIds.includes(thread.id))
    .filter((thread) => isThreadInChapterWindow(thread, scope.chapterStart ?? stageContext?.stage.chapterStart ?? undefined, scope.chapterEnd ?? stageContext?.stage.chapterEnd ?? undefined))
    .filter((thread) => {
      if (!stageContext) return true
      const related = parseIds(thread.relatedCharacterIdsJson)
      const hasStageRange = scope.chapterStart !== undefined || scope.chapterEnd !== undefined || stageContext.stage.chapterStart != null || stageContext.stage.chapterEnd != null
      return intersect(related, characterIds) || hasStageRange
    })
    .filter((thread) => isKeywordMatch([thread.title, thread.summary, thread.premise, thread.currentState, thread.notes], scope.keyword))
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id)
}

function filterTree(tree: WorldMapItem[], scope: NarrativeBoardQueryInput, stageContext: CreativeStageContext | null): WorldMapItem[] {
  if (!stageContext) return tree
  if (stageContext.activeMapIds.length === 0) return []
  return filterWorldMapTreeByIds(tree, new Set(stageContext.activeMapIds))
}

function mapTreeIds(tree: WorldMapItem[]): Set<number> {
  const ids = new Set<number>()
  const visit = (nodes: WorldMapItem[]) => nodes.forEach((node) => {
    ids.add(node.id)
    visit(node.children || [])
  })
  visit(tree)
  return ids
}

function mapDescendantIds(tree: WorldMapItem[], mapNodeId?: number): Set<number> | null {
  if (!mapNodeId) return null
  const visit = (nodes: WorldMapItem[]): Set<number> | null => {
    for (const node of nodes) {
      if (node.id === mapNodeId) return mapTreeIds([node])
      const nested = visit(node.children || [])
      if (nested) return nested
    }
    return null
  }
  return visit(tree) || new Set<number>()
}

export function getMapLayout(novelId: number, layoutKey = DEFAULT_LAYOUT_KEY, mapNodeIds?: number[]): MapBoardLayoutNode[] {
  const key = normalizeLayoutKey(layoutKey)
  const ids = mapNodeIds?.map(positiveId).filter((value): value is number => typeof value === 'number') || []
  if (ids.length > 0) ensureLayoutRows(novelId, key, ids)
  // An explicitly empty id list is a valid scoped result (for example an
  // archived stage); do not accidentally return another scope's layout.
  return getMapLayoutRows(novelId, key, mapNodeIds === undefined ? undefined : ids)
}

export function upsertMapLayoutNode(input: MapBoardLayoutNodeInput): MapBoardLayoutNode {
  const novelId = positiveId(input.novelId)
  const mapNodeId = positiveId(input.mapNodeId)
  if (!novelId || !mapNodeId) throwUserFacingError('narrativeBoard.layoutInvalid')
  const sqlite = getSqlite()
  const map = sqlite.prepare('SELECT id, novel_id FROM world_map WHERE id = ? LIMIT 1').get(mapNodeId) as { id: number; novel_id: number } | undefined
  if (!map || Number(map.novel_id) !== novelId) throwUserFacingError('narrativeBoard.mapNodeWrongNovel')
  const key = normalizeLayoutKey(input.layoutKey)
  const version = getNovelContextVersion(novelId)
  const values = {
    x: boundedNumber(input.x, 0, -100000, 100000),
    y: boundedNumber(input.y, 0, -100000, 100000),
    width: boundedNumber(input.width, 260, 140, 1200),
    height: boundedNumber(input.height, 150, 90, 900),
    layerKey: typeof input.layerKey === 'string' && input.layerKey.trim() ? input.layerKey.trim().slice(0, 40) : 'regions',
    visible: input.visible === 0 ? 0 : 1,
    zIndex: Math.round(boundedNumber(input.zIndex, 0, -10000, 10000)),
    layoutVersion: Math.max(1, Math.round(boundedNumber(input.layoutVersion, 1, 1, 1000000))),
  }
  sqlite.prepare(`
    INSERT INTO narrative_map_layout_nodes
      (novel_id, map_node_id, layout_key, x, y, width, height, layer_key, visible, z_index, layout_version, context_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(novel_id, map_node_id, layout_key) DO UPDATE SET
      x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height,
      layer_key = excluded.layer_key, visible = excluded.visible, z_index = excluded.z_index,
      layout_version = excluded.layout_version, context_version = excluded.context_version,
      updated_at = CURRENT_TIMESTAMP
  `).run(novelId, mapNodeId, key, values.x, values.y, values.width, values.height, values.layerKey, values.visible, values.zIndex, values.layoutVersion, version)
  const row = sqlite.prepare(`SELECT * FROM narrative_map_layout_nodes WHERE novel_id = ? AND map_node_id = ? AND layout_key = ?`).get(novelId, mapNodeId, key) as DbRow | undefined
  if (!row) throwUserFacingError('narrativeBoard.layoutSaveFailed')
  return mapBoardLayoutRow(row)
}

export function saveMapViewport(input: MapBoardViewportInput): MapBoardViewport {
  const novelId = positiveId(input.novelId)
  if (!novelId) throwUserFacingError('narrativeBoard.viewportNovelIdInvalid')
  const sqlite = getSqlite()
  const novel = sqlite.prepare('SELECT id FROM novels WHERE id = ? LIMIT 1').get(novelId) as { id: number } | undefined
  if (!novel) throwUserFacingError('narrativeBoard.viewportNovelNotFound')
  const key = normalizeLayoutKey(input.layoutKey)
  const version = getNovelContextVersion(novelId)
  const centerX = boundedNumber(input.centerX, 0, -100000, 100000)
  const centerY = boundedNumber(input.centerY, 0, -100000, 100000)
  const zoom = boundedNumber(input.zoom, 1, 0.12, 2.5)
  const activeLayers = normalizeLayers(input.activeLayers)
  const layoutVersion = Math.max(1, Math.round(boundedNumber(input.layoutVersion, 1, 1, 1000000)))
  sqlite.prepare(`
    INSERT INTO narrative_map_viewports
      (novel_id, layout_key, center_x, center_y, zoom, active_layers_json, layout_version, context_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(novel_id, layout_key) DO UPDATE SET
      center_x = excluded.center_x, center_y = excluded.center_y, zoom = excluded.zoom,
      active_layers_json = excluded.active_layers_json, layout_version = excluded.layout_version,
      context_version = excluded.context_version, updated_at = CURRENT_TIMESTAMP
  `).run(novelId, key, centerX, centerY, zoom, JSON.stringify(activeLayers), layoutVersion, version)
  const row = sqlite.prepare('SELECT * FROM narrative_map_viewports WHERE novel_id = ? AND layout_key = ? LIMIT 1').get(novelId, key) as DbRow | undefined
  if (!row) throwUserFacingError('narrativeBoard.viewportSaveFailed')
  return mapViewportRow(row)
}

export function listLocationBindings(scope: { novelId: number; characterId?: number; mapNodeId?: number; stageId?: number; chapterStart?: number; chapterEnd?: number }): CharacterLocationBinding[] {
  const chapters = chapterService.listChapters(scope.novelId) as unknown as Chapter[]
  const stageContext = resolveStageContext(scope.novelId, positiveId(scope.stageId))
  const normalized = normalizeScope({ ...scope, novelId: scope.novelId })
  const tree = mapService.getMapTree(scope.novelId) as unknown as WorldMapItem[]
  const mapScopeIds = mapDescendantIds(filterTree(tree, normalized, stageContext), normalized.mapNodeId)
  return getBindings(normalized, stageContext, chapters.map((chapter) => ({ id: chapter.id, chapterNum: chapter.chapterNum })), mapScopeIds)
    .filter((binding) => !scope.characterId || binding.characterId === scope.characterId)
    .filter((binding) => !scope.mapNodeId || binding.mapNodeId === scope.mapNodeId)
}

export function upsertLocationBinding(input: CharacterLocationBindingInput): CharacterLocationBinding {
  const novelId = positiveId(input.novelId)
  const characterId = positiveId(input.characterId)
  const mapNodeId = positiveId(input.mapNodeId)
  if (!novelId || !characterId || !mapNodeId) throwUserFacingError('narrativeBoard.bindingParamsInvalid')
  const sqlite = getSqlite()
  const character = sqlite.prepare('SELECT id, novel_id FROM characters WHERE id = ? LIMIT 1').get(characterId) as { id: number; novel_id: number } | undefined
  const map = sqlite.prepare('SELECT id, novel_id FROM world_map WHERE id = ? LIMIT 1').get(mapNodeId) as { id: number; novel_id: number } | undefined
  if (!character || !map || Number(character.novel_id) !== novelId || Number(map.novel_id) !== novelId) throwUserFacingError('narrativeBoard.bindingWrongNovel')
  const contextVersion = getNovelContextVersion(novelId)
  const bindingType = typeof input.bindingType === 'string' && input.bindingType.trim() ? input.bindingType.trim().slice(0, 40) : 'presence'
  const sourceType = typeof input.sourceType === 'string' && input.sourceType.trim() ? input.sourceType.trim().slice(0, 40) : 'manual'
  const sourceId = input.sourceId == null ? null : positiveId(input.sourceId) || null
  const confidence = boundedNumber(input.confidence, 1, 0, 1)
  const canonical = input.isCanonical === 0 ? 0 : 1
  const startId = input.chapterStartId == null ? null : positiveId(input.chapterStartId) || null
  const endId = input.chapterEndId == null ? null : positiveId(input.chapterEndId) || null
  const existing = sqlite.prepare(`
    SELECT id FROM character_location_binding
    WHERE novel_id = ? AND character_id = ? AND map_node_id = ?
      AND binding_type = ? AND source_type = ?
      AND COALESCE(source_id, 0) = COALESCE(?, 0)
      AND COALESCE(chapter_start_id, 0) = COALESCE(?, 0)
      AND COALESCE(chapter_end_id, 0) = COALESCE(?, 0)
    LIMIT 1
  `).get(novelId, characterId, mapNodeId, bindingType, sourceType, sourceId, startId, endId) as { id: number } | undefined
  if (existing) {
    sqlite.prepare(`
      UPDATE character_location_binding
      SET confidence = ?, is_canonical = ?, notes = ?, context_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(confidence, canonical, input.notes ?? null, contextVersion, Number(existing.id))
  } else {
    sqlite.prepare(`
      INSERT INTO character_location_binding
        (novel_id, character_id, map_node_id, binding_type, chapter_start_id, chapter_end_id, source_type, source_id, confidence, is_canonical, notes, context_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(novelId, characterId, mapNodeId, bindingType, startId, endId, sourceType, sourceId, confidence, canonical, input.notes ?? null, contextVersion)
  }
  const row = sqlite.prepare(`
    SELECT * FROM character_location_binding
    WHERE novel_id = ? AND character_id = ? AND map_node_id = ?
      AND binding_type = ? AND source_type = ?
      AND COALESCE(source_id, 0) = COALESCE(?, 0)
      AND COALESCE(chapter_start_id, 0) = COALESCE(?, 0)
      AND COALESCE(chapter_end_id, 0) = COALESCE(?, 0)
    ORDER BY id DESC LIMIT 1
  `).get(novelId, characterId, mapNodeId, bindingType, sourceType, sourceId, startId, endId) as DbRow | undefined
  if (!row) throwUserFacingError('narrativeBoard.bindingSaveFailed')
  return mapBindingRow(row)
}

export function getNarrativeBoardSnapshot(input: NarrativeBoardQueryInput): NarrativeBoardSnapshot {
  const scope = normalizeScope(input)
  const stageContext = resolveStageContext(scope.novelId, scope.stageId)
  const stages = creativeStageService.listCreativeStages(scope.novelId, false)
  const chapters = chapterService.listChapters(scope.novelId) as unknown as Chapter[]
  const chapterNumbers = chapters.map((chapter) => ({ id: chapter.id, chapterNum: chapter.chapterNum }))
  const allTree = mapService.getMapTree(scope.novelId) as unknown as WorldMapItem[]
  const tree = filterTree(allTree, scope, stageContext)
  const visibleMapIds = mapTreeIds(tree)
  const selectedMapIds = mapDescendantIds(tree, scope.mapNodeId)
  const mapRelations = mapService.getMapRelations(scope.novelId)
    .filter((relation) => visibleMapIds.has(relation.mapAId) && visibleMapIds.has(relation.mapBId))
    .filter((relation) => !selectedMapIds || (selectedMapIds.has(relation.mapAId) || selectedMapIds.has(relation.mapBId)))
  const layout = getMapLayout(scope.novelId, scope.layoutKey, [...visibleMapIds])
  const viewport = getOrCreateViewport(scope.novelId, normalizeLayoutKey(scope.layoutKey))

  const allFactions = factionService.listFactions(scope.novelId) as Faction[]
  const allCharacters = characterService.listCharacters(scope.novelId) as Character[]
  const characters = filterCharacters(allCharacters, scope, stageContext, allFactions)
  const stageCharacterIds = stageContext ? stageContext.activeCharacterIds : undefined
  const graph = characterService.getCharacterGraph({
    novelId: scope.novelId,
    recordStatus: 'all',
    characterIds: stageCharacterIds,
    limit: 0,
  }) as unknown as CharacterGraphPayload
  const graphCharacters = filterCharacters(graph.characters, scope, stageContext, allFactions)
  const graphCharacterIds = new Set(graphCharacters.map((character) => character.id))
  const graphRelations = graph.relations.filter((relation) => graphCharacterIds.has(relation.charAId) && graphCharacterIds.has(relation.charBId))

  const allThreads = storyThreadService.listStoryThreads(scope.novelId) as StoryThread[]
  const threads = filterThreads(allThreads, scope, stageContext, new Set(characters.map((character) => character.id)))
  const events = filterEvents(timelineService.listTimelineEvents(scope.novelId) as TimelineEvent[], scope, stageContext, chapterNumbers, visibleMapIds, new Set(characters.map((character) => character.id)), allThreads, selectedMapIds)
  const tasks = filterTasks(taskService.listTasks(scope.novelId) as Task[], scope, stageContext, visibleMapIds, new Set(characters.map((character) => character.id)), chapterNumbers, selectedMapIds)
  const bindings = getBindings(scope, stageContext, chapterNumbers, selectedMapIds)
  const factions = allFactions.filter((faction) => !scope.factionIds?.length || scope.factionIds.includes(faction.id))
  const scopedChapters = chapters.filter((chapter) => {
    const start = scope.chapterStart ?? stageContext?.stage.chapterStart ?? undefined
    const end = scope.chapterEnd ?? stageContext?.stage.chapterEnd ?? undefined
    return (!start || chapter.chapterNum >= start) && (!end || chapter.chapterNum <= end)
  })
  const novelStats = {
    totalChapters: scopedChapters.length,
    completedChapters: scopedChapters.filter((chapter) => chapter.status === 'final').length,
    totalWords: scopedChapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0),
    characterCount: characters.length,
  }
  const contextStatus = novelService.getNovelContextStatus(scope.novelId) as NovelContextStatus
  const quality = qualityDashboardService.getQualityDashboardData(scope.novelId) as QualityDashboardData
  const unresolvedAnchors = (timelineService.listTimelineEvents(scope.novelId) as TimelineEvent[])
    .filter((event) => event.anchorInvalid || (!event.chapterStartId && !event.chapterEndId))
    .filter((event) => !isTimelineEventInChapterWindow(event, {
      chapterStart: scope.chapterStart ?? stageContext?.stage.chapterStart ?? undefined,
      chapterEnd: scope.chapterEnd ?? stageContext?.stage.chapterEnd ?? undefined,
    }, new Map(chapterNumbers.map((chapter) => [chapter.id, chapter.chapterNum])), true)).length

  return {
    novelId: scope.novelId,
    scope,
    tree,
    mapRelations,
    mapLayout: layout,
    viewport,
    characterGraph: { characters: graphCharacters, relations: graphRelations },
    characters,
    bindings,
    events,
    chapters: scopedChapters,
    tasks,
    factions,
    threads,
    stages,
    stageContext,
    contextStatus,
    quality,
    novelStats,
    totals: {
      map: visibleMapIds.size,
      characters: characters.length,
      relations: graphRelations.length,
      events: events.length,
      tasks: tasks.length,
      threads: threads.length,
      unresolvedAnchors,
    },
  }
}
