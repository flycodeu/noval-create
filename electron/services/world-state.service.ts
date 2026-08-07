import { asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapters,
  chapterSegments,
  characterRelations,
  characterStateVersions,
  characters,
  factions,
  storyItems,
  timelineEvents,
  worldMap,
  worldStateVersions,
} from '../database/schema'

type ChapterRow = typeof chapters.$inferSelect
type TimelineEventRow = typeof timelineEvents.$inferSelect
type WorldStateVersionRow = typeof worldStateVersions.$inferSelect
type WorldStateVersionInsert = typeof worldStateVersions.$inferInsert

export type WorldStateEntityType = 'character' | 'faction' | 'item' | 'relation' | 'location'
export type WorldStateSeverity = 'info' | 'warning' | 'critical'
export type WorldStateAlertType = 'drift' | 'conflict'

export interface WorldStateSummary {
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  chapterId: number
  chapterNum: number
  summaryText: string
  stateItems: string[]
  eventCause?: string
  changeReason?: string
  severity: WorldStateSeverity
  triggerEventId?: number
  sourceSegmentId?: number
  stateDeltaJson?: string
}

export interface WorldStateAlert {
  alertType: WorldStateAlertType
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  chapterId: number
  chapterNum: number
  stateKey?: string
  severity: WorldStateSeverity
  score: number
  reasons: string[]
  summary: string
}

export interface WorldStateTrendPoint {
  chapterNum: number
  driftCount: number
  conflictCount: number
  warningCount: number
}

export interface WorldStateLedgerEntity extends WorldStateSummary {
  alerts: WorldStateAlert[]
  driftCount: number
  conflictCount: number
}

export interface WorldStateLedgerConflictEntity {
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  severity: WorldStateSeverity
  chapterId: number
  chapterNum: number
  summaryText: string
  alertCount: number
  driftCount: number
  conflictCount: number
  reasons: string[]
}

export interface WorldStateLedgerOverview {
  trackedEntityCount: number
  trackedByType: Record<WorldStateEntityType, number>
  driftAlertCount: number
  conflictAlertCount: number
  warningCount: number
  criticalCount: number
  conflictEntityCount: number
  recentConflictEntities: string[]
}

export interface WorldStateLedgerSnapshot {
  generatedAt: string
  upToChapterNum?: number
  entities: WorldStateLedgerEntity[]
  alerts: WorldStateAlert[]
  conflictEntities: WorldStateLedgerConflictEntity[]
  trend: WorldStateTrendPoint[]
  trendSummary: string[]
  overview: WorldStateLedgerOverview
  worldStatesText: string
}

export interface WorldStateContextSnapshot {
  currentStates: WorldStateSummary[]
  alerts: WorldStateAlert[]
  worldStatesText: string
  trendSummary: string[]
}

const WORLD_STATE_ENTITY_TYPES: WorldStateEntityType[] = ['character', 'faction', 'item', 'relation', 'location']

const CAUSE_KEYWORDS = ['因为', '因此', '所以', '受', '经历', '之后', '决定', '被迫', '转而', '改为', '恢复', '和解', '决裂', '得知', '目睹']
const ITEM_UNAVAILABLE_KEYWORDS = ['损坏', '损毁', '破损', '失效', '遗失', '耗尽', '报废', '断裂', '不可用', '丢失']
const FACTION_COLLAPSE_KEYWORDS = ['覆灭', '瓦解', '崩溃', '溃散', '灭亡', '解散']
const RELATION_HOSTILE_KEYWORDS = ['决裂', '敌对', '背叛', '仇恨', '死敌', '追杀']
const TEMPORARY_STATE_KEYWORDS = ['暂时', '片刻', '短暂', '一时', '临时', '缓一缓']
const RESOLVED_STATE_KEYWORDS = ['恢复', '痊愈', '解除', '放下', '稳定', '复原', '和解', '归还', '补足']
const HARD_LOCK_STATE_KEYWORDS = ['决裂', '背叛', '覆灭', '死亡', '失明', '残废', '永久']

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value)))
      .filter((value) => Number.isFinite(value))
  } catch {
    return []
  }
}

function normalizeInlineText(value: unknown, maxLength = 72): string {
  const text = asText(value)
    .replace(/\r\n/g, '\n')
    .replace(/\s*\n+\s*/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function joinCompact(
  values: unknown[],
  options: { separator?: string; maxLength?: number; perValueMaxLength?: number; limit?: number } = {},
): string {
  const separator = options.separator || '；'
  const maxLength = options.maxLength ?? 84
  const perValueMaxLength = options.perValueMaxLength ?? 40
  const normalized = dedupeStrings(
    values
      .map((value) => normalizeInlineText(value, perValueMaxLength))
      .filter(Boolean),
    options.limit,
  )
  if (normalized.length === 0) return ''
  const joined = normalized.join(separator)
  if (joined.length <= maxLength) return joined
  return `${joined.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = asText(text)
  return normalized ? keywords.some((keyword) => normalized.includes(keyword)) : false
}

function normalizeComparableText(value?: string | null): string {
  return asText(value).replace(/[，。！？；：、\s|=]/g, '')
}

function severityRank(severity?: string | null): number {
  if (severity === 'critical') return 2
  if (severity === 'warning') return 1
  return 0
}

function stateKeyLabel(stateKey: string): string {
  switch (stateKey) {
    case 'injury':
      return '伤势'
    case 'resource':
      return '资源'
    case 'stance':
      return '立场'
    case 'mental':
      return '心态'
    case 'relationship_heat':
      return '关系'
    case 'goal':
      return '目标'
    case 'faction_alignment':
      return '势力'
    case 'item_condition':
      return '物品状态'
    case 'item_holder':
      return '持有人'
    case 'item_location':
      return '位置'
    case 'relation_status':
      return '关系'
    case 'location_control':
      return '地点'
    default:
      return stateKey
  }
}

function entityTypeLabel(entityType: WorldStateEntityType): string {
  switch (entityType) {
    case 'character':
      return '人物'
    case 'faction':
      return '势力'
    case 'item':
      return '物品'
    case 'relation':
      return '关系'
    case 'location':
      return '地点'
    default:
      return entityType
  }
}

function inferSeverity(eventCause?: string | null, changeReason?: string | null): WorldStateSeverity {
  return asText(eventCause) || asText(changeReason) ? 'info' : 'warning'
}

function inferChangeReason(...values: Array<string | null | undefined>): string {
  return joinCompact(values, { maxLength: 96, perValueMaxLength: 42, limit: 3 })
}

function inferEventCause(chapter: ChapterRow, fallback?: string | null): string {
  return normalizeInlineText(chapter.summary || fallback || '', 84)
}

function inferPersistencePolicy(before?: string | null, after?: string | null, cause?: string | null): 'temporary' | 'ongoing' | 'resolved' | 'unknown' {
  const combined = joinCompact([after, cause], { maxLength: 120, perValueMaxLength: 48, limit: 3 })
  if (!normalizeComparableText(after) && normalizeComparableText(before)) return 'resolved'
  if (containsAny(combined, RESOLVED_STATE_KEYWORDS)) return 'resolved'
  if (containsAny(combined, TEMPORARY_STATE_KEYWORDS)) return 'temporary'
  if (normalizeComparableText(after)) return 'ongoing'
  return 'unknown'
}

function inferDeltaReversible(before?: string | null, after?: string | null, cause?: string | null): boolean {
  const combined = joinCompact([before, after, cause], { maxLength: 120, perValueMaxLength: 48, limit: 4 })
  if (!combined) return true
  return !containsAny(combined, HARD_LOCK_STATE_KEYWORDS)
}

function buildStateDeltaJson(field: string, before?: string | null, after?: string | null, cause?: string | null): string | null {
  if (normalizeComparableText(before) === normalizeComparableText(after)) return null
  return JSON.stringify([{
    field,
    before: before || undefined,
    after: after || undefined,
    cause: cause || undefined,
    persistencePolicy: inferPersistencePolicy(before, after, cause),
    reversible: inferDeltaReversible(before, after, cause),
  }])
}

function parseStateDeltaSummary(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return ''
    return joinCompact(
      parsed.map((item) => `${asText(item.field)}:${asText(item.before) || '空'}→${asText(item.after) || '空'}`),
      { maxLength: 96, perValueMaxLength: 28, limit: 3 },
    )
  } catch {
    return ''
  }
}

function buildStateSummaryText(name: string, stateKey: string, stateValue: string): string {
  return `${name}：${stateKeyLabel(stateKey)}=${stateValue}`
}

function pushWorldStateInsert(
  result: WorldStateVersionInsert[],
  base: Omit<WorldStateVersionInsert, 'stateKey' | 'stateValue' | 'normalizedValue' | 'summaryText'>,
  stateKey: string,
  stateValue?: string | null,
  previousValue?: string | null,
): void {
  const normalizedValue = normalizeComparableText(stateValue)
  if (!normalizedValue) return
  result.push({
    ...base,
    stateKey,
    stateValue: stateValue || null,
    normalizedValue,
    summaryText: buildStateSummaryText(String(base.entityName), stateKey, String(stateValue)),
    stateDeltaJson: buildStateDeltaJson(stateKey, previousValue, stateValue, asText(base.changeReason) || asText(base.eventCause)),
  })
}

function buildCharacterWorldStateInserts(
  novelId: number,
  options: { startChapterNum?: number } = {},
): WorldStateVersionInsert[] {
  const db = getDb()
  const characterMap = new Map(
    db.select().from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.fullName] as const),
  )
  const rows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .orderBy(asc(characterStateVersions.chapterNum), asc(characterStateVersions.id))
    .all()
    .filter((row) => options.startChapterNum === undefined || row.chapterNum >= options.startChapterNum)

  const result: WorldStateVersionInsert[] = []
  const previousValueByKey = new Map<string, string>()
  rows.forEach((row) => {
    const entityName = characterMap.get(row.characterId) || `角色#${row.characterId}`
    const base = {
      novelId,
      entityType: 'character' as const,
      entityId: row.characterId,
      entityName,
      chapterId: row.chapterId,
      chapterNum: row.chapterNum,
      eventCause: asText(row.eventCause) || null,
      changeReason: asText(row.changeReason) || null,
      sourceKind: 'character_state_version',
      sourceRef: String(row.id),
      severity: inferSeverity(row.eventCause, row.changeReason),
      triggerEventId: typeof row.triggerEventId === 'number' ? row.triggerEventId : null,
      sourceSegmentId: typeof row.sourceSegmentId === 'number' ? row.sourceSegmentId : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
    const pushWithPrevious = (stateKey: string, value?: string | null) => {
      const previousKey = `${row.characterId}:${stateKey}`
      pushWorldStateInsert(result, base, stateKey, value, previousValueByKey.get(previousKey))
      const normalized = normalizeComparableText(value)
      if (normalized) previousValueByKey.set(previousKey, value || '')
    }
    pushWithPrevious('injury', row.injuryState)
    pushWithPrevious('resource', row.resourceState)
    pushWithPrevious('stance', row.stanceState)
    pushWithPrevious('mental', row.mentalState)
    pushWithPrevious('relationship_heat', row.relationshipHeatSummary)
    pushWithPrevious('goal', row.goalState)
  })

  return result
}

function latestTimelineEventByPredicate(
  events: TimelineEventRow[],
  chapterNumById: Map<number, number>,
  predicate: (event: TimelineEventRow) => boolean,
  upToChapterNum: number,
): TimelineEventRow | null {
  let picked: TimelineEventRow | null = null
  let pickedChapterNum = -1
  events.forEach((event) => {
    if (!predicate(event)) return
    const anchorChapterNum = chapterNumById.get(event.chapterEndId || event.chapterStartId || 0)
      || chapterNumById.get(event.chapterStartId || 0)
      || 0
    if (anchorChapterNum <= 0 || anchorChapterNum > upToChapterNum) return
    if (anchorChapterNum > pickedChapterNum) {
      picked = event
      pickedChapterNum = anchorChapterNum
    }
  })
  return picked
}

function buildNonCharacterWorldStateInsertsForChapter(targetChapter: ChapterRow): WorldStateVersionInsert[] {
  const db = getDb()
  const novelId = targetChapter.novelId
  const now = new Date().toISOString()
  const chapterSegmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, targetChapter.id))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const fallbackSegment = chapterSegmentRows[0] || null
  const characterMap = new Map(
    db.select().from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.fullName] as const),
  )
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const mapNameById = new Map(mapRows.map((row) => [row.id, row.name] as const))
  const chapterNumById = new Map(
    db.select().from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.chapterNum] as const),
  )
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const previousRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .orderBy(desc(worldStateVersions.chapterNum), desc(worldStateVersions.id))
    .all()
    .filter((row) => row.chapterNum < targetChapter.chapterNum)
  const result: WorldStateVersionInsert[] = []
  const previousValueByKey = new Map<string, string>()
  previousRows.forEach((row) => {
    const key = `${row.entityType}:${row.entityId}:${row.stateKey}`
    if (!previousValueByKey.has(key)) previousValueByKey.set(key, row.stateValue || '')
  })

  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  itemRows
    .filter((item) => item.itemKind === 'instance')
    .forEach((item) => {
      const linkedEvent = latestTimelineEventByPredicate(
        eventRows,
        chapterNumById,
        (event) => parseNumberArray(event.linkedItemIdsJson).includes(item.id),
        targetChapter.chapterNum,
      )
      const base = {
        novelId,
        entityType: 'item' as const,
        entityId: item.id,
        entityName: item.itemName,
        chapterId: targetChapter.id,
        chapterNum: targetChapter.chapterNum,
        eventCause: inferEventCause(targetChapter, linkedEvent?.eventSummary || linkedEvent?.eventResult || ''),
        changeReason: inferChangeReason(item.acquisitionMethod, item.usageMethod, item.cost, item.risk),
        sourceKind: 'item_record',
        sourceRef: String(item.id),
        severity: inferSeverity(linkedEvent?.eventSummary, item.acquisitionMethod || item.usageMethod || item.cost || item.risk),
        triggerEventId: linkedEvent?.id || null,
        sourceSegmentId: linkedEvent?.segmentId || fallbackSegment?.id || null,
        createdAt: now,
        updatedAt: now,
      }
      pushWorldStateInsert(result, base, 'item_condition', joinCompact([item.status, item.limitations, item.risk], { maxLength: 72, perValueMaxLength: 28, limit: 3 }), previousValueByKey.get(`item:${item.id}:item_condition`))
      pushWorldStateInsert(result, base, 'item_holder', characterMap.get(item.ownerCharacterId || 0) || '', previousValueByKey.get(`item:${item.id}:item_holder`))
      pushWorldStateInsert(result, base, 'item_location', mapNameById.get(item.locationMapId || 0) || '', previousValueByKey.get(`item:${item.id}:item_location`))
    })

  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  relationRows.forEach((relation) => {
    const leftName = characterMap.get(relation.charAId) || `角色#${relation.charAId}`
    const rightName = characterMap.get(relation.charBId) || `角色#${relation.charBId}`
    const relationName = `${leftName} ↔ ${rightName}`
    const base = {
      novelId,
      entityType: 'relation' as const,
      entityId: relation.id,
      entityName: relationName,
      chapterId: targetChapter.id,
      chapterNum: targetChapter.chapterNum,
      eventCause: inferEventCause(targetChapter, relation.description),
      changeReason: inferChangeReason(relation.description, relation.interactionStyle, relation.subtextRule),
      sourceKind: 'relation_record',
      sourceRef: String(relation.id),
      severity: inferSeverity(targetChapter.summary, relation.description || relation.interactionStyle),
      triggerEventId: null,
      sourceSegmentId: fallbackSegment?.id || null,
      createdAt: now,
      updatedAt: now,
    }
    pushWorldStateInsert(result, base, 'relation_status', joinCompact([
      relation.relationLabel || relation.relationType || '',
      typeof relation.intimacyLevel === 'number' ? `亲密${relation.intimacyLevel}` : '',
      typeof relation.tensionLevel === 'number' ? `张力${relation.tensionLevel}` : '',
    ], { maxLength: 72, perValueMaxLength: 24, limit: 3 }), previousValueByKey.get(`relation:${relation.id}:relation_status`))
  })

  const factionRows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  factionRows.forEach((faction) => {
    const leaderName = characterMap.get(faction.leaderCharacterId || 0) || ''
    const base = {
      novelId,
      entityType: 'faction' as const,
      entityId: faction.id,
      entityName: faction.name,
      chapterId: targetChapter.id,
      chapterNum: targetChapter.chapterNum,
      eventCause: inferEventCause(targetChapter, faction.notes),
      changeReason: inferChangeReason(faction.currentPhase, faction.goal, faction.resources),
      sourceKind: 'faction_record',
      sourceRef: String(faction.id),
      severity: inferSeverity(targetChapter.summary, faction.currentPhase || faction.goal || faction.resources),
      triggerEventId: null,
      sourceSegmentId: fallbackSegment?.id || null,
      createdAt: now,
      updatedAt: now,
    }
    pushWorldStateInsert(result, base, 'faction_alignment', joinCompact([
      faction.currentPhase,
      faction.goal,
      faction.resources,
      leaderName ? `首领=${leaderName}` : '',
    ], { maxLength: 80, perValueMaxLength: 28, limit: 3 }), previousValueByKey.get(`faction:${faction.id}:faction_alignment`))
  })

  mapRows.forEach((node) => {
    const affiliatedFactionNames = parseNumberArray(node.affiliatedFactionIdsJson)
      .map((id) => factionRows.find((faction) => faction.id === id)?.name || '')
      .filter(Boolean)
    const base = {
      novelId,
      entityType: 'location' as const,
      entityId: node.id,
      entityName: node.name,
      chapterId: targetChapter.id,
      chapterNum: targetChapter.chapterNum,
      eventCause: inferEventCause(targetChapter, node.plotRelevance),
      changeReason: inferChangeReason(node.plotRelevance, node.description),
      sourceKind: 'location_record',
      sourceRef: String(node.id),
      severity: inferSeverity(targetChapter.summary, node.plotRelevance || node.description),
      triggerEventId: null,
      sourceSegmentId: fallbackSegment?.id || null,
      createdAt: now,
      updatedAt: now,
    }
    pushWorldStateInsert(result, base, 'location_control', joinCompact([
      affiliatedFactionNames.length > 0 ? `势力=${affiliatedFactionNames.join('、')}` : '',
      node.plotRelevance,
      node.atmosphere,
    ], { maxLength: 80, perValueMaxLength: 32, limit: 3 }), previousValueByKey.get(`location:${node.id}:location_control`))
  })

  return result
}

export function refreshWorldStateVersionsForChapter(chapterId: number): void {
  const db = getDb()
  const targetChapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!targetChapter) return

  const characterRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, targetChapter.novelId))
    .all()
    .filter((row) => row.entityType === 'character')
  if (characterRows.length > 0) {
    db.delete(worldStateVersions).where(inArray(worldStateVersions.id, characterRows.map((row) => row.id))).run()
  }

  const characterInserts = buildCharacterWorldStateInserts(targetChapter.novelId)
  if (characterInserts.length > 0) {
    db.insert(worldStateVersions).values(characterInserts).run()
  }

  const staleRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, targetChapter.novelId))
    .all()
    .filter((row) => row.entityType !== 'character' && row.chapterId === targetChapter.id)
  if (staleRows.length > 0) {
    db.delete(worldStateVersions).where(inArray(worldStateVersions.id, staleRows.map((row) => row.id))).run()
  }

  const nonCharacterInserts = buildNonCharacterWorldStateInsertsForChapter(targetChapter)
  if (nonCharacterInserts.length > 0) {
    db.insert(worldStateVersions).values(nonCharacterInserts).run()
  }
}

export function refreshWorldStateVersionsFromChapter(novelId: number, startChapterNum: number): void {
  const db = getDb()
  const normalizedStartChapterNum = Math.max(1, Math.round(startChapterNum || 1))
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()

  if (chapterRows.length === 0) {
    db.delete(worldStateVersions).where(eq(worldStateVersions.novelId, novelId)).run()
    return
  }

  const affectedChapters = chapterRows.filter((chapter) => chapter.chapterNum >= normalizedStartChapterNum)
  if (affectedChapters.length === 0) return

  const staleCharacterRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .all()
    .filter((row) => row.entityType === 'character' && row.chapterNum >= normalizedStartChapterNum)
  if (staleCharacterRows.length > 0) {
    db.delete(worldStateVersions).where(inArray(worldStateVersions.id, staleCharacterRows.map((row) => row.id))).run()
  }

  const characterInserts = buildCharacterWorldStateInserts(novelId, {
    startChapterNum: normalizedStartChapterNum,
  })
  if (characterInserts.length > 0) {
    db.insert(worldStateVersions).values(characterInserts).run()
  }

  const staleNonCharacterRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .all()
    .filter((row) => row.entityType !== 'character' && affectedChapters.some((chapter) => chapter.id === row.chapterId))
  if (staleNonCharacterRows.length > 0) {
    db.delete(worldStateVersions).where(inArray(worldStateVersions.id, staleNonCharacterRows.map((row) => row.id))).run()
  }

  affectedChapters.forEach((chapter) => {
    const inserts = buildNonCharacterWorldStateInsertsForChapter(chapter)
    if (inserts.length > 0) {
      db.insert(worldStateVersions).values(inserts).run()
    }
  })
}

export function refreshWorldStateVersionsForNovel(novelId: number): void {
  const db = getDb()
  const latestChapter = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(desc(chapters.chapterNum), desc(chapters.id))
    .all()[0]

  if (!latestChapter) {
    db.delete(worldStateVersions).where(eq(worldStateVersions.novelId, novelId)).run()
    return
  }

  refreshWorldStateVersionsForChapter(latestChapter.id)
}

function summarizeEntityStateRows(rows: WorldStateVersionRow[]): WorldStateSummary | null {
  if (rows.length === 0) return null
  const latestChapterNum = Math.max(...rows.map((row) => row.chapterNum))
  const latestRows = rows.filter((row) => row.chapterNum === latestChapterNum)
  const stateItems = latestRows
    .map((row) => `${stateKeyLabel(row.stateKey)}=${asText(row.stateValue)}`)
    .filter((item) => item.split('=').at(-1))
  const severity = latestRows.reduce<WorldStateSeverity>((current, row) => (
    severityRank(row.severity) > severityRank(current) ? (row.severity as WorldStateSeverity || 'info') : current
  ), 'info')
  const pivot = latestRows[0]
  return {
    entityType: pivot.entityType as WorldStateEntityType,
    entityId: pivot.entityId,
    entityName: pivot.entityName,
    chapterId: pivot.chapterId,
    chapterNum: pivot.chapterNum,
    summaryText: joinCompact(stateItems, { separator: ' | ', maxLength: 128, perValueMaxLength: 44, limit: 4 }),
    stateItems,
    eventCause: latestRows.map((row) => asText(row.eventCause)).find(Boolean) || '',
    changeReason: latestRows.map((row) => asText(row.changeReason)).find(Boolean) || '',
    severity,
    triggerEventId: latestRows.find((row) => typeof row.triggerEventId === 'number')?.triggerEventId || undefined,
    sourceSegmentId: latestRows.find((row) => typeof row.sourceSegmentId === 'number')?.sourceSegmentId || undefined,
    stateDeltaJson: latestRows.map((row) => asText(row.stateDeltaJson)).find(Boolean) || undefined,
  }
}

function entityTypeRank(entityType: WorldStateEntityType): number {
  switch (entityType) {
    case 'character':
      return 0
    case 'item':
      return 1
    case 'relation':
      return 2
    case 'faction':
      return 3
    case 'location':
      return 4
    default:
      return 5
  }
}

function collectLatestWorldStates(
  novelId: number,
  options: {
    upToChapterNum?: number
    entityTypes?: WorldStateEntityType[]
  } = {},
): WorldStateSummary[] {
  const db = getDb()
  const rows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .orderBy(desc(worldStateVersions.chapterNum), desc(worldStateVersions.id))
    .all()
    .filter((row) => options.upToChapterNum === undefined || row.chapterNum <= options.upToChapterNum)
    .filter((row) => !options.entityTypes || options.entityTypes.includes(row.entityType as WorldStateEntityType))

  const entityStateMap = new Map<string, WorldStateVersionRow>()
  rows.forEach((row) => {
    const key = `${row.entityType}:${row.entityId}:${row.stateKey}`
    if (!entityStateMap.has(key)) {
      entityStateMap.set(key, row)
    }
  })

  const byEntity = new Map<string, WorldStateVersionRow[]>()
  entityStateMap.forEach((row) => {
    const key = `${row.entityType}:${row.entityId}`
    const current = byEntity.get(key) || []
    current.push(row)
    byEntity.set(key, current)
  })

  return [...byEntity.values()]
    .map((group) => summarizeEntityStateRows(group))
    .filter((item): item is WorldStateSummary => Boolean(item))
    .filter((item) => item.stateItems.length > 0)
    .sort((left, right) => {
      const severityDiff = severityRank(right.severity) - severityRank(left.severity)
      if (severityDiff !== 0) return severityDiff
      const chapterDiff = right.chapterNum - left.chapterNum
      if (chapterDiff !== 0) return chapterDiff
      const typeDiff = entityTypeRank(left.entityType) - entityTypeRank(right.entityType)
      if (typeDiff !== 0) return typeDiff
      return left.entityName.localeCompare(right.entityName, 'zh-Hans-CN')
    })
}

export function listLatestWorldStates(
  novelId: number,
  options: {
    upToChapterNum?: number
    entityTypes?: WorldStateEntityType[]
    limit?: number
  } = {},
): WorldStateSummary[] {
  return collectLatestWorldStates(novelId, options).slice(0, options.limit ?? 12)
}

export function listWorldStateHistory(
  novelId: number,
  entityType: WorldStateEntityType,
  entityId: number,
  stateKey?: string,
  limit = 12,
): WorldStateVersionRow[] {
  return getDb().select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .orderBy(desc(worldStateVersions.chapterNum), desc(worldStateVersions.id))
    .all()
    .filter((row) => row.entityType === entityType && row.entityId === entityId)
    .filter((row) => !stateKey || row.stateKey === stateKey)
    .slice(0, limit)
}

function hasExplicitCause(row: WorldStateVersionRow): boolean {
  return containsAny(joinCompact([row.changeReason, row.eventCause], { maxLength: 120 }), CAUSE_KEYWORDS)
}

function detectWorldStateDrift(history: WorldStateVersionRow[]): WorldStateAlert | null {
  if (history.length < 2) return null
  const latest = history[0]
  const previous = history.find((row) => row.chapterNum < latest.chapterNum)
  if (!previous) return null
  if (latest.normalizedValue === previous.normalizedValue) return null
  if (hasExplicitCause(latest)) return null

  const reason = `${stateKeyLabel(latest.stateKey)}变化缺少明确事件原因`
  return {
    alertType: 'drift',
    entityType: latest.entityType as WorldStateEntityType,
    entityId: latest.entityId,
    entityName: latest.entityName,
    chapterId: latest.chapterId,
    chapterNum: latest.chapterNum,
    stateKey: latest.stateKey,
    severity: latest.entityType === 'character' ? 'warning' : 'info',
    score: latest.entityType === 'character' ? 80 : 60,
    reasons: [reason],
    summary: `${entityTypeLabel(latest.entityType as WorldStateEntityType)} ${latest.entityName} 在第${latest.chapterNum}章发生${stateKeyLabel(latest.stateKey)}跳变，但缺少事件承接。`,
  }
}

function buildConflictAlerts(novelId: number, upToChapterNum?: number): WorldStateAlert[] {
  const db = getDb()
  const latestStates = collectLatestWorldStates(novelId, { upToChapterNum })
  const summaryByEntity = new Map(latestStates.map((item) => [`${item.entityType}:${item.entityId}`, item] as const))
  const result: WorldStateAlert[] = []

  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  itemRows
    .filter((item) => item.itemKind === 'instance')
    .forEach((item) => {
      const summary = summaryByEntity.get(`item:${item.id}`)
      const conditionText = summary?.stateItems.find((entry) => entry.startsWith('物品状态=')) || ''
      if (conditionText && containsAny(conditionText, ITEM_UNAVAILABLE_KEYWORDS) && (item.ownerCharacterId || item.locationMapId)) {
        result.push({
          alertType: 'conflict',
          entityType: 'item',
          entityId: item.id,
          entityName: item.itemName,
          chapterId: summary?.chapterId || 0,
          chapterNum: summary?.chapterNum || 0,
          stateKey: 'item_condition',
          severity: 'warning',
          score: 72,
          reasons: ['物品已标记为损坏/失效，但仍保留明确持有人或位置，需要确认是否还能继续使用'],
          summary: `物品 ${item.itemName} 当前状态疑似冲突：已不可用，但仍显示有明确持有人或位置。`,
        })
      }
    })

  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  const characterMap = new Map(
    db.select().from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.fullName] as const),
  )
  relationRows.forEach((relation) => {
    const relationText = joinCompact([relation.relationLabel, relation.relationType], { maxLength: 48, perValueMaxLength: 20, limit: 2 })
    if (!relationText || !containsAny(relationText, RELATION_HOSTILE_KEYWORDS) || Number(relation.intimacyLevel || 0) < 70) return
    const entityName = `${characterMap.get(relation.charAId) || `角色#${relation.charAId}`} ↔ ${characterMap.get(relation.charBId) || `角色#${relation.charBId}`}`
    const summary = summaryByEntity.get(`relation:${relation.id}`)
    result.push({
      alertType: 'conflict',
      entityType: 'relation',
      entityId: relation.id,
      entityName,
      chapterId: summary?.chapterId || 0,
      chapterNum: summary?.chapterNum || 0,
      stateKey: 'relation_status',
      severity: 'warning',
      score: 68,
      reasons: ['关系标签已转为敌对/决裂，但当前亲密度仍异常偏高'],
      summary: `关系 ${entityName} 当前数值疑似冲突：敌对标签与高亲密度并存。`,
    })
  })

  const factionRows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  factionRows.forEach((faction) => {
    if (!containsAny(asText(faction.currentPhase), FACTION_COLLAPSE_KEYWORDS)) return
    const territoryCount = parseNumberArray(faction.territoryMapNodeIdsJson).length
    if (territoryCount === 0 && !faction.leaderCharacterId) return
    const summary = summaryByEntity.get(`faction:${faction.id}`)
    result.push({
      alertType: 'conflict',
      entityType: 'faction',
      entityId: faction.id,
      entityName: faction.name,
      chapterId: summary?.chapterId || 0,
      chapterNum: summary?.chapterNum || 0,
      stateKey: 'faction_alignment',
      severity: 'warning',
      score: 70,
      reasons: ['势力阶段显示覆灭/瓦解，但仍保留明确领袖或大量领地挂点'],
      summary: `势力 ${faction.name} 当前状态疑似冲突：已标记衰亡，但资产挂点仍然完整。`,
    })
  })

  return result
}

function collectWorldStateAlerts(
  novelId: number,
  options: {
    upToChapterNum?: number
  } = {},
): WorldStateAlert[] {
  const db = getDb()
  const rows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .orderBy(desc(worldStateVersions.chapterNum), desc(worldStateVersions.id))
    .all()
    .filter((row) => options.upToChapterNum === undefined || row.chapterNum <= options.upToChapterNum)

  const groupedByEntityState = new Map<string, WorldStateVersionRow[]>()
  rows.forEach((row) => {
    const key = `${row.entityType}:${row.entityId}:${row.stateKey}`
    const current = groupedByEntityState.get(key) || []
    current.push(row)
    groupedByEntityState.set(key, current)
  })

  const drifts = [...groupedByEntityState.values()]
    .map((history) => detectWorldStateDrift(history))
    .filter((item): item is WorldStateAlert => Boolean(item))
  const conflicts = buildConflictAlerts(novelId, options.upToChapterNum)

  return [...drifts, ...conflicts]
    .sort((left, right) => {
      const severityDiff = severityRank(right.severity) - severityRank(left.severity)
      if (severityDiff !== 0) return severityDiff
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff
      return right.chapterNum - left.chapterNum
    })
}

export function listWorldStateAlerts(
  novelId: number,
  options: {
    upToChapterNum?: number
    limit?: number
  } = {},
): WorldStateAlert[] {
  return collectWorldStateAlerts(novelId, options).slice(0, options.limit ?? 8)
}

export function getWorldStateTrendSummary(
  novelId: number,
  options: {
    upToChapterNum?: number
  } = {},
): {
  trend: WorldStateTrendPoint[]
  summaryLines: string[]
} {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => options.upToChapterNum === undefined || chapter.chapterNum <= options.upToChapterNum)
  const alerts = collectWorldStateAlerts(novelId, { upToChapterNum: options.upToChapterNum })
  const warningRows = db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .all()
    .filter((row) => row.severity === 'warning' || row.severity === 'critical')
    .filter((row) => options.upToChapterNum === undefined || row.chapterNum <= options.upToChapterNum)

  const driftByChapter = new Map<number, number>()
  const conflictByChapter = new Map<number, number>()
  const warningByChapter = new Map<number, number>()

  alerts.forEach((alert) => {
    const target = alert.alertType === 'drift' ? driftByChapter : conflictByChapter
    target.set(alert.chapterNum, (target.get(alert.chapterNum) || 0) + 1)
  })
  warningRows.forEach((row) => {
    warningByChapter.set(row.chapterNum, (warningByChapter.get(row.chapterNum) || 0) + 1)
  })

  const trend = chapterRows.map((chapter) => ({
    chapterNum: chapter.chapterNum,
    driftCount: driftByChapter.get(chapter.chapterNum) || 0,
    conflictCount: conflictByChapter.get(chapter.chapterNum) || 0,
    warningCount: warningByChapter.get(chapter.chapterNum) || 0,
  }))

  const summaryLines = alerts
    .slice(0, 6)
    .map((alert) => `第${alert.chapterNum}章 · ${alert.summary}`)

  return { trend, summaryLines }
}

function createTrackedByTypeCounter(): Record<WorldStateEntityType, number> {
  return WORLD_STATE_ENTITY_TYPES.reduce<Record<WorldStateEntityType, number>>((result, entityType) => {
    result[entityType] = 0
    return result
  }, {} as Record<WorldStateEntityType, number>)
}

function buildWorldStateLedgerOverview(
  states: WorldStateSummary[],
  alerts: WorldStateAlert[],
  trend: WorldStateTrendPoint[],
): WorldStateLedgerOverview {
  const trackedByType = createTrackedByTypeCounter()
  states.forEach((state) => {
    trackedByType[state.entityType] += 1
  })

  const conflictEntities = new Set(
    alerts
      .filter((alert) => alert.alertType === 'conflict')
      .map((alert) => `${alert.entityType}:${alert.entityId}`),
  )

  return {
    trackedEntityCount: states.length,
    trackedByType,
    driftAlertCount: alerts.filter((alert) => alert.alertType === 'drift').length,
    conflictAlertCount: alerts.filter((alert) => alert.alertType === 'conflict').length,
    warningCount: trend.reduce((sum, point) => sum + point.warningCount, 0),
    criticalCount: alerts.filter((alert) => alert.severity === 'critical').length,
    conflictEntityCount: conflictEntities.size,
    recentConflictEntities: dedupeStrings(
      alerts
        .filter((alert) => alert.alertType === 'conflict')
        .map((alert) => `${entityTypeLabel(alert.entityType)} ${alert.entityName}`),
      6,
    ),
  }
}

function buildWorldStateLedgerConflictEntities(
  entities: WorldStateLedgerEntity[],
  alerts: WorldStateAlert[],
): WorldStateLedgerConflictEntity[] {
  const entityMap = new Map<string, WorldStateLedgerEntity>(
    entities.map((entity) => [`${entity.entityType}:${entity.entityId}`, entity] as const),
  )
  const conflictMap = new Map<string, WorldStateLedgerConflictEntity>()

  alerts.forEach((alert) => {
    const key = `${alert.entityType}:${alert.entityId}`
    const entity = entityMap.get(key)
    const current = conflictMap.get(key)
    const nextSeverity = current && severityRank(current.severity) > severityRank(alert.severity)
      ? current.severity
      : alert.severity
    const nextReasons = dedupeStrings([...(current?.reasons || []), ...alert.reasons], 6)

    conflictMap.set(key, {
      entityType: alert.entityType,
      entityId: alert.entityId,
      entityName: alert.entityName,
      severity: nextSeverity,
      chapterId: entity?.chapterId || alert.chapterId,
      chapterNum: entity?.chapterNum || alert.chapterNum,
      summaryText: entity?.summaryText || alert.summary,
      alertCount: (current?.alertCount || 0) + 1,
      driftCount: (current?.driftCount || 0) + (alert.alertType === 'drift' ? 1 : 0),
      conflictCount: (current?.conflictCount || 0) + (alert.alertType === 'conflict' ? 1 : 0),
      reasons: nextReasons,
    })
  })

  return [...conflictMap.values()]
    .sort((left, right) => {
      const severityDiff = severityRank(right.severity) - severityRank(left.severity)
      if (severityDiff !== 0) return severityDiff
      const conflictDiff = right.conflictCount - left.conflictCount
      if (conflictDiff !== 0) return conflictDiff
      const driftDiff = right.driftCount - left.driftCount
      if (driftDiff !== 0) return driftDiff
      return right.chapterNum - left.chapterNum
    })
}

export function getWorldStateLedgerSnapshot(
  novelId: number,
  options: {
    upToChapterNum?: number
    entityTypes?: WorldStateEntityType[]
    entityLimit?: number
    alertLimit?: number
    conflictEntityLimit?: number
  } = {},
): WorldStateLedgerSnapshot {
  const allStates = collectLatestWorldStates(novelId, {
    upToChapterNum: options.upToChapterNum,
    entityTypes: options.entityTypes,
  })
  const allAlerts = collectWorldStateAlerts(novelId, {
    upToChapterNum: options.upToChapterNum,
  }).filter((alert) => !options.entityTypes || options.entityTypes.includes(alert.entityType))
  const alertsByEntity = allAlerts.reduce<Map<string, WorldStateAlert[]>>((result, alert) => {
    const key = `${alert.entityType}:${alert.entityId}`
    const current = result.get(key) || []
    current.push(alert)
    result.set(key, current)
    return result
  }, new Map())
  const entities = allStates.map<WorldStateLedgerEntity>((state) => {
    const entityAlerts = alertsByEntity.get(`${state.entityType}:${state.entityId}`) || []
    return {
      ...state,
      alerts: entityAlerts,
      driftCount: entityAlerts.filter((alert) => alert.alertType === 'drift').length,
      conflictCount: entityAlerts.filter((alert) => alert.alertType === 'conflict').length,
    }
  })
  const filteredEntities = entities.slice(0, options.entityLimit ?? 12)
  const filteredAlerts = allAlerts.slice(0, options.alertLimit ?? 8)
  const conflictEntities = buildWorldStateLedgerConflictEntities(entities, allAlerts)
    .slice(0, options.conflictEntityLimit ?? 8)
  const trendSummary = getWorldStateTrendSummary(novelId, { upToChapterNum: options.upToChapterNum })
  const overview = buildWorldStateLedgerOverview(allStates, allAlerts, trendSummary.trend)
  const eventMap = new Map(
    getDb().select().from(timelineEvents)
      .where(eq(timelineEvents.novelId, novelId))
      .all()
      .map((row) => [row.id, row] as const),
  )
  const segmentMap = new Map(
    getDb().select().from(chapterSegments)
      .where(eq(chapterSegments.novelId, novelId))
      .all()
      .map((row) => [row.id, row] as const),
  )
  const worldStatesText = [
    filteredEntities.length > 0
      ? filteredEntities.map((item) => {
        const triggerEvent = item.triggerEventId ? eventMap.get(item.triggerEventId) : null
        const sourceSegment = item.sourceSegmentId ? segmentMap.get(item.sourceSegmentId) : null
        const anchorText = joinCompact([
          triggerEvent ? triggerEvent.eventTitle : '',
          sourceSegment ? sourceSegment.title || `场景${sourceSegment.segmentOrder}` : '',
        ], { maxLength: 48, perValueMaxLength: 22, limit: 2 })
        const deltaText = parseStateDeltaSummary(item.stateDeltaJson)
        return `${entityTypeLabel(item.entityType)} ${item.entityName}：${joinCompact([
          item.summaryText,
          deltaText ? `变化=${deltaText}` : '',
          anchorText ? `锚点=${anchorText}` : '',
        ], { separator: ' | ', maxLength: 160, perValueMaxLength: 64, limit: 4 })}`
      }).join('\n')
      : '',
    filteredAlerts.length > 0
      ? `告警：\n${filteredAlerts.map((item) => `- ${item.summary}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')

  return {
    generatedAt: new Date().toISOString(),
    upToChapterNum: options.upToChapterNum,
    entities: filteredEntities,
    alerts: filteredAlerts,
    conflictEntities,
    trend: trendSummary.trend,
    trendSummary: trendSummary.summaryLines,
    overview,
    worldStatesText,
  }
}

export function getWorldStateContextSnapshot(
  novelId: number,
  options: {
    upToChapterNum?: number
    limit?: number
  } = {},
): WorldStateContextSnapshot {
  const ledger = getWorldStateLedgerSnapshot(novelId, {
    upToChapterNum: options.upToChapterNum,
    entityLimit: options.limit || 12,
    alertLimit: 6,
  })

  return {
    currentStates: ledger.entities,
    alerts: ledger.alerts,
    worldStatesText: ledger.worldStatesText,
    trendSummary: ledger.trendSummary,
  }
}
