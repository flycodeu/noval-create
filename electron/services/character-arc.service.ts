import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type {
  CharacterArc,
  CharacterArcBeat,
  CharacterArcBeatInput,
  CharacterArcDashboard,
  CharacterArcInput,
  RelationshipArc,
  RelationshipArcInput,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  characterArcBeats,
  characterArcs,
  chapterContracts,
  characterRelations,
  characterStateVersions,
  characters,
  chapters,
  relationshipArcs,
  timelineEvents,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { markNovelContextChanged } from './context-impact.service'

const ROLE_PRIORITY: Record<string, number> = {
  protagonist: 0,
  major: 1,
  antagonist: 2,
  supporting: 3,
  minor: 4,
}

const AUTO_ARC_BEAT_PREFIX = '自动识别：'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => asNumber(value))
      .filter((value): value is number => typeof value === 'number' && value > 0)
  } catch {
    return []
  }
}

function normalizeComparableText(value?: string | null): string {
  return asText(value).replace(/[，。！？；：、\s|=]/g, '')
}

function isFieldChanged(previous?: string | null, current?: string | null): boolean {
  const left = normalizeComparableText(previous)
  const right = normalizeComparableText(current)
  if (!left && !right) return false
  if (left === right) return false
  if (left && right && (left.includes(right) || right.includes(left))) return false
  return true
}

function summarizeStateDelta(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return ''
    return parsed
      .map((item) => {
        const field = asText(item.field)
        const before = asText(item.before)
        const after = asText(item.after)
        return field ? `${field}:${before || '空'}→${after || '空'}` : ''
      })
      .filter(Boolean)
      .slice(0, 3)
      .join('；')
  } catch {
    return ''
  }
}

function normalizeStatus(value: unknown): CharacterArc['currentStatus'] {
  const normalized = asText(value)
  if (normalized === 'active' || normalized === 'stalled' || normalized === 'completed') return normalized
  return 'draft'
}

function buildChapterLabel(chapterNum?: number, title?: string | null) {
  if (typeof chapterNum !== 'number') return undefined
  return title?.trim() ? `第${chapterNum}章 ${title.trim()}` : `第${chapterNum}章`
}

function buildTimelineLabel(title?: string | null, timeLabel?: string | null) {
  const cleanTitle = asText(title)
  const cleanTime = asText(timeLabel)
  if (cleanTitle && cleanTime) return `${cleanTitle} · ${cleanTime}`
  return cleanTitle || cleanTime || undefined
}

function compareCharacters(
  left: typeof characters.$inferSelect,
  right: typeof characters.$inferSelect,
) {
  const leftPriority = ROLE_PRIORITY[left.roleType || 'minor'] ?? 9
  const rightPriority = ROLE_PRIORITY[right.roleType || 'minor'] ?? 9
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0)
  return (left.fullName || '').localeCompare(right.fullName || '', 'zh-Hans-CN')
}

function buildCharacterMaps(novelId: number) {
  const db = getDb()
  const characterRows = db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  const timelineRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()

  return {
    characterRows,
    characterById: new Map(characterRows.map((row) => [row.id, row] as const)),
    chapterRows,
    chapterById: new Map(chapterRows.map((row) => [row.id, row] as const)),
    timelineRows,
    timelineById: new Map(timelineRows.map((row) => [row.id, row] as const)),
  }
}

function listBeatRowsByArcId(novelId: number) {
  const db = getDb()
  const rows = db.select().from(characterArcBeats)
    .where(eq(characterArcBeats.novelId, novelId))
    .orderBy(asc(characterArcBeats.sortOrder), asc(characterArcBeats.id))
    .all()
  const grouped = new Map<number, Array<typeof characterArcBeats.$inferSelect>>()
  rows.forEach((row) => {
    const list = grouped.get(row.arcId) || []
    list.push(row)
    grouped.set(row.arcId, list)
  })
  return grouped
}

function buildBeatView(
  row: typeof characterArcBeats.$inferSelect,
  context: ReturnType<typeof buildCharacterMaps>,
): CharacterArcBeat {
  const chapter = row.chapterId ? context.chapterById.get(row.chapterId) : undefined
  const event = row.timelineEventId ? context.timelineById.get(row.timelineEventId) : undefined
  return {
    id: row.id,
    novelId: row.novelId,
    arcId: row.arcId,
    beatType: (row.beatType as CharacterArcBeat['beatType']) || 'progress-note',
    chapterId: row.chapterId ?? undefined,
    chapterNum: chapter?.chapterNum,
    chapterLabel: buildChapterLabel(chapter?.chapterNum, chapter?.title),
    timelineEventId: row.timelineEventId ?? undefined,
    timelineEventLabel: buildTimelineLabel(event?.eventTitle, event?.timeLabel),
    title: row.title || '',
    summary: row.summary || '',
    status: row.status || 'planned',
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function shouldAutoSyncArcFromState(
  current: typeof characterStateVersions.$inferSelect,
  previous?: typeof characterStateVersions.$inferSelect,
): boolean {
  if (asText(current.stateDeltaJson)) return true
  const reason = asText(current.changeReason)
  if (reason && reason !== '延续前章状态，无新增显式变化' && reason !== '沿用角色基础设定') return true
  return (
    isFieldChanged(previous?.injuryState, current.injuryState)
    || isFieldChanged(previous?.resourceState, current.resourceState)
    || isFieldChanged(previous?.stanceState, current.stanceState)
    || isFieldChanged(previous?.mentalState, current.mentalState)
    || isFieldChanged(previous?.relationshipHeatSummary, current.relationshipHeatSummary)
    || isFieldChanged(previous?.goalState, current.goalState)
  )
}

function resolveAutoBeatType(
  arc: typeof characterArcs.$inferSelect,
  current: typeof characterStateVersions.$inferSelect,
  previous?: typeof characterStateVersions.$inferSelect,
): CharacterArcBeat['beatType'] {
  const mindsetShift = isFieldChanged(previous?.goalState, current.goalState)
    || isFieldChanged(previous?.stanceState, current.stanceState)
    || isFieldChanged(previous?.mentalState, current.mentalState)
  if (!arc.firstCrackChapterId && mindsetShift) return 'crack'
  if (mindsetShift || isFieldChanged(previous?.relationshipHeatSummary, current.relationshipHeatSummary)) return 'change'
  return 'progress-note'
}

function buildAutoBeatSummary(
  current: typeof characterStateVersions.$inferSelect,
  previous?: typeof characterStateVersions.$inferSelect,
): string {
  const deltaSummary = summarizeStateDelta(current.stateDeltaJson)
  const changedFields = [
    isFieldChanged(previous?.injuryState, current.injuryState) ? `伤势=${asText(current.injuryState)}` : '',
    isFieldChanged(previous?.resourceState, current.resourceState) ? `资源=${asText(current.resourceState)}` : '',
    isFieldChanged(previous?.stanceState, current.stanceState) ? `立场=${asText(current.stanceState)}` : '',
    isFieldChanged(previous?.mentalState, current.mentalState) ? `心态=${asText(current.mentalState)}` : '',
    isFieldChanged(previous?.relationshipHeatSummary, current.relationshipHeatSummary) ? `关系=${asText(current.relationshipHeatSummary)}` : '',
    isFieldChanged(previous?.goalState, current.goalState) ? `目标=${asText(current.goalState)}` : '',
  ].filter(Boolean).slice(0, 3)
  return [
    deltaSummary,
    changedFields.join('；'),
    asText(current.changeReason),
    asText(current.eventCause),
  ].filter(Boolean).join('；')
}

function resyncCharacterArcPointers(
  novelId: number,
  startChapterNum: number,
  chapterNumById: Map<number, number>,
): void {
  const db = getDb()
  const beatRows = db.select().from(characterArcBeats)
    .where(eq(characterArcBeats.novelId, novelId))
    .orderBy(desc(characterArcBeats.sortOrder), desc(characterArcBeats.id))
    .all()
  const beatRowsByArc = new Map<number, Array<typeof characterArcBeats.$inferSelect>>()
  beatRows.forEach((row) => {
    const list = beatRowsByArc.get(row.arcId) || []
    list.push(row)
    beatRowsByArc.set(row.arcId, list)
  })

  db.select().from(characterArcs)
    .where(eq(characterArcs.novelId, novelId))
    .all()
    .forEach((arc) => {
      const arcBeats = beatRowsByArc.get(arc.id) || []
      const latestBeat = arcBeats.find((row) => typeof row.chapterId === 'number') || null
      const latestChapterNum = latestBeat?.chapterId ? (chapterNumById.get(latestBeat.chapterId) || 0) : 0
      const preservedChapterId = arc.lastProgressChapterId
        && (chapterNumById.get(arc.lastProgressChapterId) || 0) < startChapterNum
        ? arc.lastProgressChapterId
        : null
      db.update(characterArcs).set({
        lastProgressChapterId: latestBeat?.chapterId || preservedChapterId,
        currentStatus: arc.currentStatus === 'completed'
          ? 'completed'
          : latestBeat
            ? 'active'
            : arc.currentStatus === 'stalled'
              ? 'stalled'
              : 'draft',
        updatedAt: new Date().toISOString(),
      }).where(eq(characterArcs.id, arc.id)).run()
      if (!latestBeat && latestChapterNum === 0 && !preservedChapterId && arc.currentStatus !== 'draft') {
        db.update(characterArcs).set({
          lastProgressChapterId: null,
          updatedAt: new Date().toISOString(),
        }).where(eq(characterArcs.id, arc.id)).run()
      }
    })
}

export function syncCharacterArcsFromChapterState(chapterId: number): number {
  const db = getDb()
  const startChapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!startChapter) return 0

  const context = buildCharacterMaps(startChapter.novelId)
  const chapterRows = context.chapterRows.filter((row) => row.chapterNum >= startChapter.chapterNum)
  if (chapterRows.length === 0) return 0

  const affectedChapterIds = new Set(chapterRows.map((row) => row.id))
  const autoBeatRows = db.select().from(characterArcBeats)
    .where(eq(characterArcBeats.novelId, startChapter.novelId))
    .all()
    .filter((row) => row.chapterId && affectedChapterIds.has(row.chapterId) && asText(row.title).startsWith(AUTO_ARC_BEAT_PREFIX))
  if (autoBeatRows.length > 0) {
    db.delete(characterArcBeats).where(inArray(characterArcBeats.id, autoBeatRows.map((row) => row.id))).run()
  }

  const contractByChapterId = new Map(
    db.select().from(chapterContracts)
      .where(eq(chapterContracts.novelId, startChapter.novelId))
      .all()
      .map((row) => [row.chapterId, row] as const),
  )
  const arcRows = db.select().from(characterArcs)
    .where(eq(characterArcs.novelId, startChapter.novelId))
    .all()
  const arcById = new Map(arcRows.map((row) => [row.id, row] as const))
  const stateRows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, startChapter.novelId))
    .orderBy(asc(characterStateVersions.chapterNum), asc(characterStateVersions.id))
    .all()
  const stateRowsByChapterCharacter = new Map<string, typeof characterStateVersions.$inferSelect>()
  const previousStateByCharacter = new Map<number, typeof characterStateVersions.$inferSelect>()
  stateRows.forEach((row) => {
    stateRowsByChapterCharacter.set(`${row.chapterId}:${row.characterId}`, row)
    if (row.chapterNum < startChapter.chapterNum) {
      previousStateByCharacter.set(row.characterId, row)
    }
  })

  let syncedCount = 0
  chapterRows.forEach((chapter) => {
    const contract = contractByChapterId.get(chapter.id)
    const requiredArcIds = parseNumberArray(contract?.requiredCharacterArcIdsJson)
    requiredArcIds.forEach((arcId) => {
      const arc = arcById.get(arcId)
      if (!arc) return
      const currentState = stateRowsByChapterCharacter.get(`${chapter.id}:${arc.characterId}`)
      if (!currentState) return
      const previousState = previousStateByCharacter.get(arc.characterId)
      if (!shouldAutoSyncArcFromState(currentState, previousState)) return

      const existingBeat = db.select().from(characterArcBeats)
        .where(and(eq(characterArcBeats.arcId, arc.id), eq(characterArcBeats.chapterId, chapter.id)))
        .orderBy(desc(characterArcBeats.sortOrder), desc(characterArcBeats.id))
        .all()[0] || null
      const beatTitle = `${AUTO_ARC_BEAT_PREFIX}${context.characterById.get(arc.characterId)?.fullName || `角色#${arc.characterId}`} 第${chapter.chapterNum}章推进`
      const beatSummary = buildAutoBeatSummary(currentState, previousState)
      const beatType = resolveAutoBeatType(arc, currentState, previousState)
      const now = new Date().toISOString()

      if (existingBeat && !asText(existingBeat.title).startsWith(AUTO_ARC_BEAT_PREFIX)) {
        db.update(characterArcs).set({
          lastProgressChapterId: chapter.id,
          currentStatus: arc.currentStatus === 'completed' ? 'completed' : 'active',
          updatedAt: now,
        }).where(eq(characterArcs.id, arc.id)).run()
        syncedCount += 1
        return
      }

      if (existingBeat) {
        db.update(characterArcBeats).set({
          beatType,
          timelineEventId: currentState.triggerEventId ?? existingBeat.timelineEventId,
          title: beatTitle,
          summary: beatSummary,
          status: 'logged',
          updatedAt: now,
        }).where(eq(characterArcBeats.id, existingBeat.id)).run()
      } else {
        db.insert(characterArcBeats).values({
          novelId: startChapter.novelId,
          arcId: arc.id,
          beatType,
          chapterId: chapter.id,
          timelineEventId: currentState.triggerEventId ?? null,
          title: beatTitle,
          summary: beatSummary,
          status: 'logged',
          sortOrder: getNextBeatSortOrder(arc.id),
          createdAt: now,
          updatedAt: now,
        }).run()
      }

      db.update(characterArcs).set({
        firstCrackChapterId: arc.firstCrackChapterId || (beatType === 'crack' ? chapter.id : null),
        changeTimelineEventId: arc.changeTimelineEventId || currentState.triggerEventId || null,
        lastProgressChapterId: chapter.id,
        currentStatus: arc.currentStatus === 'completed' ? 'completed' : 'active',
        updatedAt: now,
      }).where(eq(characterArcs.id, arc.id)).run()
      syncedCount += 1
    })

    stateRows
      .filter((row) => row.chapterId === chapter.id)
      .forEach((row) => previousStateByCharacter.set(row.characterId, row))
  })

  resyncCharacterArcPointers(
    startChapter.novelId,
    startChapter.chapterNum,
    new Map(context.chapterRows.map((row) => [row.id, row.chapterNum] as const)),
  )
  if (syncedCount > 0) {
    markNovelContextChanged(startChapter.novelId, 'Character arc auto-sync updated')
  }
  return syncedCount
}

function buildCharacterArcView(
  row: typeof characterArcs.$inferSelect,
  context: ReturnType<typeof buildCharacterMaps>,
  beatRows: Array<typeof characterArcBeats.$inferSelect> = [],
): CharacterArc {
  const character = context.characterById.get(row.characterId)
  if (!character) throwUserFacingError('character.notFound')
  const firstCrackChapter = row.firstCrackChapterId ? context.chapterById.get(row.firstCrackChapterId) : undefined
  const lastProgressChapter = row.lastProgressChapterId ? context.chapterById.get(row.lastProgressChapterId) : undefined
  const changeEvent = row.changeTimelineEventId ? context.timelineById.get(row.changeTimelineEventId) : undefined
  const beats = beatRows.map((item) => buildBeatView(item, context))
  const latestBeat = beats.at(-1)

  return {
    id: row.id,
    novelId: row.novelId,
    characterId: row.characterId,
    characterName: character.fullName,
    roleType: character.roleType as CharacterArc['roleType'],
    startState: row.startState || '',
    surfaceWant: row.surfaceWant || '',
    deepNeed: row.deepNeed || '',
    coreFear: row.coreFear || '',
    misbelief: row.misbelief || '',
    firstCrackChapterId: row.firstCrackChapterId ?? undefined,
    firstCrackChapterNum: firstCrackChapter?.chapterNum,
    firstCrackChapterLabel: buildChapterLabel(firstCrackChapter?.chapterNum, firstCrackChapter?.title),
    changeEvent: row.changeEvent || '',
    changeTimelineEventId: row.changeTimelineEventId ?? undefined,
    changeTimelineEventLabel: buildTimelineLabel(changeEvent?.eventTitle, changeEvent?.timeLabel),
    endState: row.endState || '',
    currentStatus: normalizeStatus(row.currentStatus),
    lastProgressChapterId: row.lastProgressChapterId ?? undefined,
    lastProgressChapterNum: lastProgressChapter?.chapterNum,
    lastProgressChapterLabel: buildChapterLabel(lastProgressChapter?.chapterNum, lastProgressChapter?.title),
    stalledReason: row.stalledReason || '',
    notes: row.notes || '',
    beatCount: beats.length,
    latestBeatSummary: latestBeat?.summary || latestBeat?.title || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    beats,
  }
}

function buildRelationshipArcView(
  row: typeof relationshipArcs.$inferSelect,
  context: ReturnType<typeof buildCharacterMaps>,
): RelationshipArc {
  const charA = context.characterById.get(row.charAId)
  const charB = context.characterById.get(row.charBId)
  if (!charA || !charB) throwUserFacingError('character.notFound')
  const lastProgressChapter = row.lastProgressChapterId ? context.chapterById.get(row.lastProgressChapterId) : undefined
  const changeEvent = row.changeTimelineEventId ? context.timelineById.get(row.changeTimelineEventId) : undefined

  return {
    id: row.id,
    novelId: row.novelId,
    charAId: row.charAId,
    charBId: row.charBId,
    charAName: charA.fullName,
    charBName: charB.fullName,
    relationLabelSnapshot: row.relationLabelSnapshot || '',
    relationTypeSnapshot: row.relationTypeSnapshot || undefined,
    startState: row.startState || '',
    crackPoint: row.crackPoint || '',
    changeEvent: row.changeEvent || '',
    changeTimelineEventId: row.changeTimelineEventId ?? undefined,
    changeTimelineEventLabel: buildTimelineLabel(changeEvent?.eventTitle, changeEvent?.timeLabel),
    endState: row.endState || '',
    currentStatus: normalizeStatus(row.currentStatus),
    lastProgressChapterId: row.lastProgressChapterId ?? undefined,
    lastProgressChapterNum: lastProgressChapter?.chapterNum,
    lastProgressChapterLabel: buildChapterLabel(lastProgressChapter?.chapterNum, lastProgressChapter?.title),
    stalledReason: row.stalledReason || '',
    notes: row.notes || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function getCharacterById(characterId: number) {
  const db = getDb()
  const row = db.select().from(characters).where(eq(characters.id, characterId)).all()[0]
  if (!row) throwUserFacingError('character.notFound')
  return row
}

function resolveCharacterArcRow(data: CharacterArcInput) {
  const db = getDb()
  if (data.id) {
    const row = db.select().from(characterArcs).where(eq(characterArcs.id, data.id)).all()[0]
    if (!row) throwUserFacingError('character.notFound')
    return row
  }
  return db.select().from(characterArcs).where(eq(characterArcs.characterId, data.characterId)).all()[0] || null
}

function resolveRelationshipPair(
  charAId: number,
  charBId: number,
): { charAId: number; charBId: number } {
  return charAId <= charBId ? { charAId, charBId } : { charAId: charBId, charBId: charAId }
}

function getNextBeatSortOrder(arcId: number) {
  const db = getDb()
  const latest = db.select().from(characterArcBeats)
    .where(eq(characterArcBeats.arcId, arcId))
    .orderBy(desc(characterArcBeats.sortOrder), desc(characterArcBeats.id))
    .all()[0]
  return (latest?.sortOrder || 0) + 1
}

export function listCharacterArcs(novelId: number): CharacterArc[] {
  const db = getDb()
  const context = buildCharacterMaps(novelId)
  const beatRowsByArcId = listBeatRowsByArcId(novelId)
  return db.select().from(characterArcs)
    .where(eq(characterArcs.novelId, novelId))
    .orderBy(asc(characterArcs.id))
    .all()
    .map((row) => buildCharacterArcView(row, context, beatRowsByArcId.get(row.id) || []))
    .sort((left, right) => {
      const leftCharacter = context.characterById.get(left.characterId)
      const rightCharacter = context.characterById.get(right.characterId)
      if (!leftCharacter || !rightCharacter) return 0
      return compareCharacters(leftCharacter, rightCharacter)
    })
}

export function getCharacterArc(arcId: number): CharacterArc | null {
  const db = getDb()
  const row = db.select().from(characterArcs).where(eq(characterArcs.id, arcId)).all()[0]
  if (!row) return null
  const context = buildCharacterMaps(row.novelId)
  const beatRows = db.select().from(characterArcBeats)
    .where(eq(characterArcBeats.arcId, arcId))
    .orderBy(asc(characterArcBeats.sortOrder), asc(characterArcBeats.id))
    .all()
  return buildCharacterArcView(row, context, beatRows)
}

export function upsertCharacterArc(data: CharacterArcInput): CharacterArc {
  const db = getDb()
  const character = getCharacterById(data.characterId)
  const current = resolveCharacterArcRow(data)
  const timestamp = new Date().toISOString()

  if (current) {
    db.update(characterArcs).set({
      startState: data.startState !== undefined ? asText(data.startState) : current.startState,
      surfaceWant: data.surfaceWant !== undefined ? asText(data.surfaceWant) : current.surfaceWant,
      deepNeed: data.deepNeed !== undefined ? asText(data.deepNeed) : current.deepNeed,
      coreFear: data.coreFear !== undefined ? asText(data.coreFear) : current.coreFear,
      misbelief: data.misbelief !== undefined ? asText(data.misbelief) : current.misbelief,
      firstCrackChapterId: data.firstCrackChapterId !== undefined ? asNumber(data.firstCrackChapterId) ?? null : current.firstCrackChapterId,
      changeEvent: data.changeEvent !== undefined ? asText(data.changeEvent) : current.changeEvent,
      changeTimelineEventId: data.changeTimelineEventId !== undefined ? asNumber(data.changeTimelineEventId) ?? null : current.changeTimelineEventId,
      endState: data.endState !== undefined ? asText(data.endState) : current.endState,
      currentStatus: data.currentStatus !== undefined ? normalizeStatus(data.currentStatus) : normalizeStatus(current.currentStatus),
      lastProgressChapterId: data.lastProgressChapterId !== undefined ? asNumber(data.lastProgressChapterId) ?? null : current.lastProgressChapterId,
      stalledReason: data.stalledReason !== undefined ? asText(data.stalledReason) : current.stalledReason,
      notes: data.notes !== undefined ? asText(data.notes) : current.notes,
      updatedAt: timestamp,
    }).where(eq(characterArcs.id, current.id)).run()
  } else {
    db.insert(characterArcs).values({
      novelId: character.novelId,
      characterId: character.id,
      startState: asText(data.startState),
      surfaceWant: asText(data.surfaceWant) || character.surfaceDesire || '',
      deepNeed: asText(data.deepNeed) || character.deepNeed || '',
      coreFear: asText(data.coreFear) || character.coreFear || '',
      misbelief: asText(data.misbelief) || character.selfDeception || '',
      firstCrackChapterId: asNumber(data.firstCrackChapterId) ?? null,
      changeEvent: asText(data.changeEvent),
      changeTimelineEventId: asNumber(data.changeTimelineEventId) ?? null,
      endState: asText(data.endState),
      currentStatus: normalizeStatus(data.currentStatus),
      lastProgressChapterId: asNumber(data.lastProgressChapterId) ?? null,
      stalledReason: asText(data.stalledReason),
      notes: asText(data.notes) || character.characterArc || '',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  markNovelContextChanged(character.novelId, 'Character arcs changed')
  return listCharacterArcs(character.novelId).find((item) => item.characterId === character.id) as CharacterArc
}

export function upsertCharacterArcBeat(data: CharacterArcBeatInput): CharacterArcBeat {
  const db = getDb()
  const arc = db.select().from(characterArcs).where(eq(characterArcs.id, data.arcId)).all()[0]
  if (!arc) throwUserFacingError('character.notFound')
  const current = data.id
    ? db.select().from(characterArcBeats).where(and(eq(characterArcBeats.id, data.id), eq(characterArcBeats.arcId, data.arcId))).all()[0] || null
    : null
  const timestamp = new Date().toISOString()
  const nextBeatType = (data.beatType || current?.beatType || 'progress-note') as CharacterArcBeat['beatType']
  const nextChapterId = data.chapterId !== undefined ? asNumber(data.chapterId) ?? null : current?.chapterId ?? null
  const nextTimelineEventId = data.timelineEventId !== undefined ? asNumber(data.timelineEventId) ?? null : current?.timelineEventId ?? null

  if (current) {
    db.update(characterArcBeats).set({
      beatType: nextBeatType,
      chapterId: nextChapterId,
      timelineEventId: nextTimelineEventId,
      title: data.title !== undefined ? asText(data.title) : current.title,
      summary: data.summary !== undefined ? asText(data.summary) : current.summary,
      status: data.status !== undefined ? asText(data.status) || current.status : current.status,
      sortOrder: data.sortOrder !== undefined ? asNumber(data.sortOrder) ?? current.sortOrder : current.sortOrder,
      updatedAt: timestamp,
    }).where(eq(characterArcBeats.id, current.id)).run()
  } else {
    db.insert(characterArcBeats).values({
      novelId: arc.novelId,
      arcId: arc.id,
      beatType: nextBeatType,
      chapterId: nextChapterId,
      timelineEventId: nextTimelineEventId,
      title: asText(data.title) || '弧线推进',
      summary: asText(data.summary),
      status: asText(data.status) || 'planned',
      sortOrder: asNumber(data.sortOrder) ?? getNextBeatSortOrder(arc.id),
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  const nextStatus = nextBeatType === 'end'
    ? 'completed'
    : arc.currentStatus === 'completed'
      ? 'completed'
      : arc.currentStatus === 'stalled' && !nextChapterId
        ? 'stalled'
        : 'active'

  db.update(characterArcs).set({
    firstCrackChapterId: nextBeatType === 'crack' && nextChapterId ? nextChapterId : arc.firstCrackChapterId,
    changeTimelineEventId: nextBeatType === 'change' && nextTimelineEventId ? nextTimelineEventId : arc.changeTimelineEventId,
    lastProgressChapterId: nextChapterId ?? arc.lastProgressChapterId,
    currentStatus: nextStatus,
    updatedAt: timestamp,
  }).where(eq(characterArcs.id, arc.id)).run()

  markNovelContextChanged(arc.novelId, 'Character arcs changed')
  const nextArc = getCharacterArc(arc.id)
  const nextBeat = nextArc?.beats.find((item) => item.id === data.id) || nextArc?.beats.at(-1)
  if (!nextBeat) throwUserFacingError('characterArc.beatSaveFailed')
  return nextBeat
}

export function listRelationshipArcs(novelId: number): RelationshipArc[] {
  const db = getDb()
  const context = buildCharacterMaps(novelId)
  return db.select().from(relationshipArcs)
    .where(eq(relationshipArcs.novelId, novelId))
    .orderBy(asc(relationshipArcs.id))
    .all()
    .map((row) => buildRelationshipArcView(row, context))
    .sort((left, right) => `${left.charAName}${left.charBName}`.localeCompare(`${right.charAName}${right.charBName}`, 'zh-Hans-CN'))
}

export function upsertRelationshipArc(data: RelationshipArcInput): RelationshipArc {
  const db = getDb()
  const pair = resolveRelationshipPair(data.charAId, data.charBId)
  const charA = getCharacterById(pair.charAId)
  const charB = getCharacterById(pair.charBId)
  if (charA.novelId !== charB.novelId) throwUserFacingError('character.notFound')
  const relation = db.select().from(characterRelations)
    .where(and(
      eq(characterRelations.novelId, charA.novelId),
      eq(characterRelations.charAId, pair.charAId),
      eq(characterRelations.charBId, pair.charBId),
    ))
    .all()[0]
    || db.select().from(characterRelations)
      .where(and(
        eq(characterRelations.novelId, charA.novelId),
        eq(characterRelations.charAId, pair.charBId),
        eq(characterRelations.charBId, pair.charAId),
      ))
      .all()[0]
    || null

  const current = data.id
    ? db.select().from(relationshipArcs).where(eq(relationshipArcs.id, data.id)).all()[0] || null
    : db.select().from(relationshipArcs)
      .where(and(
        eq(relationshipArcs.novelId, charA.novelId),
        eq(relationshipArcs.charAId, pair.charAId),
        eq(relationshipArcs.charBId, pair.charBId),
      ))
      .all()[0]
      || null
  const timestamp = new Date().toISOString()

  if (current) {
    db.update(relationshipArcs).set({
      relationLabelSnapshot: data.relationLabelSnapshot !== undefined
        ? asText(data.relationLabelSnapshot)
        : (current.relationLabelSnapshot || relation?.relationLabel || ''),
      relationTypeSnapshot: data.relationTypeSnapshot !== undefined
        ? asText(data.relationTypeSnapshot)
        : (current.relationTypeSnapshot || relation?.relationType || ''),
      startState: data.startState !== undefined ? asText(data.startState) : current.startState,
      crackPoint: data.crackPoint !== undefined ? asText(data.crackPoint) : current.crackPoint,
      changeEvent: data.changeEvent !== undefined ? asText(data.changeEvent) : current.changeEvent,
      changeTimelineEventId: data.changeTimelineEventId !== undefined ? asNumber(data.changeTimelineEventId) ?? null : current.changeTimelineEventId,
      endState: data.endState !== undefined ? asText(data.endState) : current.endState,
      currentStatus: data.currentStatus !== undefined ? normalizeStatus(data.currentStatus) : normalizeStatus(current.currentStatus),
      lastProgressChapterId: data.lastProgressChapterId !== undefined ? asNumber(data.lastProgressChapterId) ?? null : current.lastProgressChapterId,
      stalledReason: data.stalledReason !== undefined ? asText(data.stalledReason) : current.stalledReason,
      notes: data.notes !== undefined ? asText(data.notes) : current.notes,
      updatedAt: timestamp,
    }).where(eq(relationshipArcs.id, current.id)).run()
  } else {
    db.insert(relationshipArcs).values({
      novelId: charA.novelId,
      charAId: pair.charAId,
      charBId: pair.charBId,
      relationLabelSnapshot: asText(data.relationLabelSnapshot) || relation?.relationLabel || '',
      relationTypeSnapshot: asText(data.relationTypeSnapshot) || relation?.relationType || '',
      startState: asText(data.startState),
      crackPoint: asText(data.crackPoint),
      changeEvent: asText(data.changeEvent),
      changeTimelineEventId: asNumber(data.changeTimelineEventId) ?? null,
      endState: asText(data.endState),
      currentStatus: normalizeStatus(data.currentStatus),
      lastProgressChapterId: asNumber(data.lastProgressChapterId) ?? null,
      stalledReason: asText(data.stalledReason),
      notes: asText(data.notes),
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  markNovelContextChanged(charA.novelId, 'Character arcs changed')
  return listRelationshipArcs(charA.novelId).find((item) => item.charAId === pair.charAId && item.charBId === pair.charBId) as RelationshipArc
}

export function getArcDashboard(novelId: number): CharacterArcDashboard {
  const context = buildCharacterMaps(novelId)
  const characterArcsList = listCharacterArcs(novelId)
  const relationshipArcsList = listRelationshipArcs(novelId)
  const protagonistArc = characterArcsList.find((item) => item.roleType === 'protagonist') || null
  const availableCharacters = [...context.characterRows].sort(compareCharacters)
  const availableRelations = getDb().select().from(characterRelations)
    .where(eq(characterRelations.novelId, novelId))
    .orderBy(desc(characterRelations.tensionLevel), asc(characterRelations.id))
    .all()
    .filter((row) => context.characterById.has(row.charAId) && context.characterById.has(row.charBId))
    .map((row) => ({
      id: row.id,
      novelId: row.novelId,
      charAId: row.charAId,
      charBId: row.charBId,
      relationType: row.relationType || undefined,
      relationLabel: row.relationLabel || undefined,
      bilateral: row.bilateral || 0,
      description: row.description || undefined,
      intimacyLevel: row.intimacyLevel || undefined,
      tensionLevel: row.tensionLevel || undefined,
      interactionStyle: row.interactionStyle || undefined,
      subtextRule: row.subtextRule || undefined,
    }))

  return {
    protagonistArc,
    characterArcs: characterArcsList,
    relationshipArcs: relationshipArcsList,
    availableCharacters: availableCharacters.map((row) => ({
      id: row.id,
      novelId: row.novelId,
      roleType: (row.roleType as CharacterArc['roleType']) || 'minor',
      recordStatus: (row.recordStatus as 'draft' | 'confirmed') || 'confirmed',
      entityType: row.entityType || undefined,
      species: row.species || undefined,
      surname: row.surname || undefined,
      givenName: row.givenName || undefined,
      fullName: row.fullName,
      gender: row.gender || undefined,
      age: row.age || undefined,
      birthplace: row.birthplace || undefined,
      occupation: row.occupation || undefined,
      rankLevel: row.rankLevel || undefined,
      socialIdentity: row.socialIdentity || undefined,
      background: row.background || undefined,
      personalityTraitsJson: row.personalityTraitsJson || undefined,
      flawsJson: row.flawsJson || undefined,
      habitsJson: row.habitsJson || undefined,
      campFactionIdsJson: row.campFactionIdsJson || undefined,
      powerSystemRefsJson: row.powerSystemRefsJson || undefined,
      contextHooksJson: row.contextHooksJson || undefined,
      goals: row.goals || undefined,
      firstImpression: row.firstImpression || undefined,
      surfaceDesire: row.surfaceDesire || undefined,
      deepNeed: row.deepNeed || undefined,
      coreFear: row.coreFear || undefined,
      innerConflict: row.innerConflict || undefined,
      hiddenSecret: row.hiddenSecret || undefined,
      moralLine: row.moralLine || undefined,
      selfDeception: row.selfDeception || undefined,
      trauma: row.trauma || undefined,
      contradiction: row.contradiction || undefined,
      relationshipTension: row.relationshipTension || undefined,
      resonancePoint: row.resonancePoint || undefined,
      characterArc: row.characterArc || undefined,
      speechPattern: row.speechPattern || undefined,
      catchphrases: row.catchphrases || undefined,
      vocabularyLevel: row.vocabularyLevel || undefined,
      dialectFeatures: row.dialectFeatures || undefined,
      appearanceJson: row.appearanceJson || undefined,
      abilitiesJson: row.abilitiesJson || undefined,
      sourceContextJson: row.sourceContextJson || undefined,
      appearChapter: row.appearChapter || undefined,
      sortOrder: row.sortOrder || 0,
      createdAt: row.createdAt || '',
      updatedAt: row.updatedAt || '',
    })),
    availableRelations,
    chapters: context.chapterRows.map((row) => ({
      id: row.id,
      chapterNum: row.chapterNum,
      title: row.title?.trim() || `第${row.chapterNum}章`,
    })),
    timelineEvents: context.timelineRows.map((row) => ({
      id: row.id,
      eventTitle: row.eventTitle,
      timeLabel: row.timeLabel,
      chapterStartId: row.chapterStartId ?? undefined,
      chapterEndId: row.chapterEndId ?? undefined,
    })),
    stalledCharacterCount: characterArcsList.filter((item) => item.currentStatus === 'stalled').length,
    stalledRelationshipCount: relationshipArcsList.filter((item) => item.currentStatus === 'stalled').length,
  }
}
