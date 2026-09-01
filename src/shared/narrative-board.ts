import type { Character, MapNodeSummary, TimelineEvent, WorldMapItem } from '../types'

export type NarrativeBoardMode = 'map' | 'characters' | 'progress'
export type CharacterBoardLayout = 'relations' | 'factions' | 'locations'

/**
 * Shared scope carried by the map, character and progress boards.
 * It is intentionally transport-friendly so it can later be passed to the
 * narrative-board IPC service without changing the URL contract.
 */
export interface NarrativeScope {
  novelId: number
  stageId?: number
  volumeId?: number
  chapterStart?: number
  chapterEnd?: number
  storyThreadIds?: number[]
  timelineEventId?: number
  taskId?: number
  mapNodeId?: number
  characterIds?: number[]
  factionIds?: number[]
  timeMode: 'current-stage' | 'chapter-window' | 'event-anchor' | 'all-canon'
}

export interface ParsedNarrativeBoardRoute {
  mode: NarrativeBoardMode
  layout: CharacterBoardLayout
  /** 当前地图看板正在浏览哪一层；与 scope.mapNodeId 的选中对象分离。 */
  mapViewNodeId?: number
  scope: NarrativeScope
}

function positiveInt(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function positiveIntArray(value: string | null | undefined): number[] | undefined {
  if (!value) return undefined
  const values = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0)
  return values.length > 0 ? [...new Set(values)] : undefined
}

export function parseNarrativeBoardRoute(search: string, novelId: number): ParsedNarrativeBoardRoute {
  const params = new URLSearchParams(search)
  const stageId = positiveInt(params.get('stageId'))
  const chapterStart = positiveInt(params.get('chapterStart'))
  const chapterEnd = positiveInt(params.get('chapterEnd'))
  const timelineEventId = positiveInt(params.get('eventId'))
  const taskId = positiveInt(params.get('taskId'))
  const mapNodeId = positiveInt(params.get('mapNodeId')) || positiveInt(params.get('nodeId'))
  const mapViewNodeId = positiveInt(params.get('mapViewNodeId'))
  const focusCharacterId = positiveInt(params.get('focusCharacterId')) || positiveInt(params.get('characterId'))
  const storyThreadIds = positiveIntArray(params.get('threadIds')) || positiveIntArray(params.get('threadId'))
  const modeValue = params.get('mode')
  const mode: NarrativeBoardMode = modeValue === 'characters' || modeValue === 'progress' ? modeValue : 'map'
  const layoutValue = params.get('layout')
  const layout: CharacterBoardLayout = layoutValue === 'factions' || layoutValue === 'locations' ? layoutValue : 'relations'

  return {
    mode,
    layout,
    ...(mapViewNodeId ? { mapViewNodeId } : {}),
    scope: {
      novelId,
      stageId,
      chapterStart,
      chapterEnd,
      storyThreadIds,
      timelineEventId,
      taskId,
      mapNodeId,
      characterIds: focusCharacterId ? [focusCharacterId] : undefined,
      timeMode: stageId ? 'current-stage' : chapterStart || chapterEnd ? 'chapter-window' : timelineEventId ? 'event-anchor' : 'all-canon',
    },
  }
}

export function setNarrativeBoardParam(
  search: string,
  key: string,
  value: number | string | null | undefined,
): URLSearchParams {
  const next = new URLSearchParams(search)
  if (value === null || value === undefined || value === '') next.delete(key)
  else next.set(key, String(value))
  return next
}

export function parseJsonTokens(raw?: string | null): Array<number | string> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item
        if (typeof item === 'string' && item.trim()) return item.trim()
        return null
      })
      .filter((item): item is number | string => item !== null)
  } catch {
    return []
  }
}

export function parseJsonNumberIds(...values: Array<string | null | undefined>): number[] {
  return [...new Set(values.flatMap((value) => parseJsonTokens(value).filter((item): item is number => typeof item === 'number')))]
}

export function flattenWorldMapTree(tree: WorldMapItem[]): WorldMapItem[] {
  return tree.flatMap((item) => [item, ...flattenWorldMapTree(item.children || [])])
}

export function findWorldMapNode(tree: WorldMapItem[], id?: number): WorldMapItem | null {
  if (!id) return null
  for (const item of tree) {
    if (item.id === id) return item
    const nested = findWorldMapNode(item.children || [], id)
    if (nested) return nested
  }
  return null
}

export function getWorldMapPath(tree: WorldMapItem[], id?: number): WorldMapItem[] {
  if (!id) return []
  for (const item of tree) {
    if (item.id === id) return [item]
    const nested = getWorldMapPath(item.children || [], id)
    if (nested.length > 0) return [item, ...nested]
  }
  return []
}

export function getWorldMapDescendantIds(node: WorldMapItem | null): number[] {
  if (!node) return []
  return [node.id, ...(node.children || []).flatMap((child) => getWorldMapDescendantIds(child))]
}

export function filterWorldMapTreeByIds(tree: WorldMapItem[], allowedIds: Set<number>): WorldMapItem[] {
  return tree
    .map((item) => ({ ...item, children: filterWorldMapTreeByIds(item.children || [], allowedIds) }))
    .filter((item) => allowedIds.has(item.id) || (item.children || []).length > 0)
}

export function isTimelineEventInChapterWindow(
  event: TimelineEvent,
  scope: Pick<NarrativeScope, 'chapterStart' | 'chapterEnd'>,
  chapterNumById?: ReadonlyMap<number, number>,
  strictAnchors = false,
): boolean {
  if (!scope.chapterStart && !scope.chapterEnd) return true
  if (strictAnchors && event.anchorInvalid) return false
  const startId = event.chapterStartId || event.chapterEndId
  const endId = event.chapterEndId || event.chapterStartId
  const eventStart = startId && chapterNumById?.get(startId)
  const eventEnd = endId && chapterNumById?.get(endId)
  // Chapter ids are not chapter numbers. The legacy/default policy retains an
  // unresolved hand-authored event; strict board scopes deliberately exclude
  // it and surface it through the unresolvedAnchors diagnostic.
  if (!eventStart && !eventEnd) return !strictAnchors
  const rangeStart = scope.chapterStart || Number.NEGATIVE_INFINITY
  const rangeEnd = scope.chapterEnd || Number.POSITIVE_INFINITY
  return (eventStart || eventEnd || 0) <= rangeEnd && (eventEnd || eventStart || 0) >= rangeStart
}

export function characterTokens(character: Pick<Character, 'activeRegionsJson'>): Array<number | string> {
  return parseJsonTokens(character.activeRegionsJson)
}

export function mapNodeMatchesTokens(node: Pick<MapNodeSummary, 'id' | 'name'>, tokens: Array<number | string>): boolean {
  return tokens.some((token) => token === node.id || (typeof token === 'string' && token === node.name))
}
