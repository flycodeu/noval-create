import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  Character,
  Faction,
  ResistanceBeat,
  ResistanceBeatInput,
  ResistanceDashboard,
  ResistanceTrack,
  ResistanceTrackInput,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapters,
  characters,
  factions,
  resistanceBeats,
  resistanceTracks,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { markNovelContextChanged } from './context-impact.service'

const CHARACTER_ROLE_PRIORITY: Record<string, number> = {
  antagonist: 0,
  protagonist: 1,
  major: 2,
  supporting: 3,
  minor: 4,
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function normalizeSourceType(value: unknown): ResistanceTrack['sourceType'] {
  const normalized = asText(value)
  if (normalized === 'faction' || normalized === 'environment' || normalized === 'institution') return normalized
  return 'character'
}

function normalizeKind(value: unknown, sourceType?: ResistanceTrack['sourceType']): ResistanceTrack['resistanceKind'] {
  const normalized = asText(value)
  if (normalized === 'faction' || normalized === 'environment' || normalized === 'institution') return normalized
  if (normalized === 'antagonist') return normalized
  if (sourceType === 'faction') return 'faction'
  if (sourceType === 'environment') return 'environment'
  if (sourceType === 'institution') return 'institution'
  return 'antagonist'
}

function normalizeStatus(value: unknown): ResistanceTrack['currentStatus'] {
  const normalized = asText(value)
  if (normalized === 'active' || normalized === 'stalled' || normalized === 'contained' || normalized === 'resolved') return normalized
  return 'draft'
}

function normalizeBeatType(value: unknown): ResistanceBeat['beatType'] {
  const normalized = asText(value)
  if (
    normalized === 'setup'
    || normalized === 'strike'
    || normalized === 'victory'
    || normalized === 'setback'
    || normalized === 'escalation'
    || normalized === 'counter'
  ) return normalized
  return 'status-note'
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

function buildVolumeLabel(volumeNumber?: number, title?: string | null) {
  if (typeof volumeNumber !== 'number') return undefined
  return title?.trim() ? `第${volumeNumber}卷 ${title.trim()}` : `第${volumeNumber}卷`
}

function compareCharacters(
  left: typeof characters.$inferSelect,
  right: typeof characters.$inferSelect,
) {
  const leftPriority = CHARACTER_ROLE_PRIORITY[left.roleType || 'minor'] ?? 9
  const rightPriority = CHARACTER_ROLE_PRIORITY[right.roleType || 'minor'] ?? 9
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0)
  return (left.fullName || '').localeCompare(right.fullName || '', 'zh-Hans-CN')
}

function compareFactions(
  left: typeof factions.$inferSelect,
  right: typeof factions.$inferSelect,
) {
  if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0)
  return (left.name || '').localeCompare(right.name || '', 'zh-Hans-CN')
}

function buildContext(novelId: number) {
  const db = getDb()
  const characterRows = db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  const factionRows = db.select().from(factions)
    .where(eq(factions.novelId, novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  const timelineRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()

  return {
    characterRows,
    factionRows,
    chapterRows,
    timelineRows,
    volumeRows,
    characterById: new Map(characterRows.map((row) => [row.id, row] as const)),
    factionById: new Map(factionRows.map((row) => [row.id, row] as const)),
    chapterById: new Map(chapterRows.map((row) => [row.id, row] as const)),
    timelineById: new Map(timelineRows.map((row) => [row.id, row] as const)),
    volumeById: new Map(volumeRows.map((row) => [row.id, row] as const)),
  }
}

function listBeatRowsByTrackId(novelId: number) {
  const db = getDb()
  const rows = db.select().from(resistanceBeats)
    .where(eq(resistanceBeats.novelId, novelId))
    .orderBy(asc(resistanceBeats.sortOrder), asc(resistanceBeats.id))
    .all()
  const grouped = new Map<number, Array<typeof resistanceBeats.$inferSelect>>()
  rows.forEach((row) => {
    const list = grouped.get(row.trackId) || []
    list.push(row)
    grouped.set(row.trackId, list)
  })
  return grouped
}

function buildSourceName(
  row: typeof resistanceTracks.$inferSelect,
  context: ReturnType<typeof buildContext>,
) {
  if (row.sourceType === 'character') return context.characterById.get(row.sourceId || 0)?.fullName || '未绑定人物'
  if (row.sourceType === 'faction') return context.factionById.get(row.sourceId || 0)?.name || '未绑定势力'
  return row.title || (row.sourceType === 'environment' ? '环境阻力' : '制度阻力')
}

function buildBeatView(
  row: typeof resistanceBeats.$inferSelect,
  context: ReturnType<typeof buildContext>,
): ResistanceBeat {
  const chapter = row.chapterId ? context.chapterById.get(row.chapterId) : undefined
  const event = row.timelineEventId ? context.timelineById.get(row.timelineEventId) : undefined
  return {
    id: row.id,
    novelId: row.novelId,
    trackId: row.trackId,
    beatType: normalizeBeatType(row.beatType),
    chapterId: row.chapterId ?? undefined,
    chapterNum: chapter?.chapterNum,
    chapterLabel: buildChapterLabel(chapter?.chapterNum, chapter?.title),
    timelineEventId: row.timelineEventId ?? undefined,
    timelineEventLabel: buildTimelineLabel(event?.eventTitle, event?.timeLabel),
    title: row.title || '',
    summary: row.summary || '',
    actionMode: row.actionMode || '',
    successLevel: row.successLevel || '',
    counterResponse: row.counterResponse || '',
    protagonistImpact: row.protagonistImpact || '',
    status: row.status || 'logged',
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function buildTrackView(
  row: typeof resistanceTracks.$inferSelect,
  context: ReturnType<typeof buildContext>,
  beatRows: Array<typeof resistanceBeats.$inferSelect> = [],
): ResistanceTrack {
  const lastActionChapter = row.lastActionChapterId ? context.chapterById.get(row.lastActionChapterId) : undefined
  const nextEscalationChapter = row.nextEscalationChapterId ? context.chapterById.get(row.nextEscalationChapterId) : undefined
  const linkedVolume = row.linkedVolumeId ? context.volumeById.get(row.linkedVolumeId) : undefined
  const beats = beatRows.map((item) => buildBeatView(item, context))
  const latestBeat = beats.at(-1)

  return {
    id: row.id,
    novelId: row.novelId,
    sourceType: normalizeSourceType(row.sourceType),
    sourceId: row.sourceId ?? undefined,
    sourceName: buildSourceName(row, context),
    resistanceKind: normalizeKind(row.resistanceKind, normalizeSourceType(row.sourceType)),
    title: row.title || '',
    goal: row.goal || '',
    intelSource: row.intelSource || '',
    resourcePool: row.resourcePool || '',
    escalationPlan: row.escalationPlan || '',
    heroKnowledgeShift: row.heroKnowledgeShift || '',
    stageVictory: row.stageVictory || '',
    counterMove: row.counterMove || '',
    currentPressureMode: row.currentPressureMode || '',
    currentStatus: normalizeStatus(row.currentStatus),
    lastActionChapterId: row.lastActionChapterId ?? undefined,
    lastActionChapterNum: lastActionChapter?.chapterNum,
    lastActionChapterLabel: buildChapterLabel(lastActionChapter?.chapterNum, lastActionChapter?.title),
    nextEscalationChapterId: row.nextEscalationChapterId ?? undefined,
    nextEscalationChapterNum: nextEscalationChapter?.chapterNum,
    nextEscalationChapterLabel: buildChapterLabel(nextEscalationChapter?.chapterNum, nextEscalationChapter?.title),
    linkedVolumeId: row.linkedVolumeId ?? undefined,
    linkedVolumeLabel: buildVolumeLabel(linkedVolume?.volumeNumber, linkedVolume?.title),
    notes: row.notes || '',
    beatCount: beats.length,
    latestBeatSummary: latestBeat?.summary || latestBeat?.title || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    beats,
  }
}

function getCharacterById(characterId: number) {
  const db = getDb()
  const row = db.select().from(characters).where(eq(characters.id, characterId)).all()[0]
  if (!row) throwUserFacingError('character.notFound')
  return row
}

function getFactionById(factionId: number) {
  const db = getDb()
  const row = db.select().from(factions).where(eq(factions.id, factionId)).all()[0]
  if (!row) throwUserFacingError('faction.notFound')
  return row
}

function resolveTrackRow(data: ResistanceTrackInput) {
  const db = getDb()
  if (data.id) {
    const row = db.select().from(resistanceTracks).where(eq(resistanceTracks.id, data.id)).all()[0]
    if (!row) throwUserFacingError('common.notFound')
    return row
  }
  const sourceType = normalizeSourceType(data.sourceType)
  const sourceId = asNumber(data.sourceId)
  const resistanceKind = normalizeKind(data.resistanceKind, sourceType)
  if (sourceId && (sourceType === 'character' || sourceType === 'faction')) {
    return db.select().from(resistanceTracks)
      .where(and(
        eq(resistanceTracks.novelId, data.novelId),
        eq(resistanceTracks.sourceType, sourceType),
        eq(resistanceTracks.sourceId, sourceId),
        eq(resistanceTracks.resistanceKind, resistanceKind),
      ))
      .all()[0] || null
  }
  return null
}

function getNextBeatSortOrder(trackId: number) {
  const db = getDb()
  const latest = db.select().from(resistanceBeats)
    .where(eq(resistanceBeats.trackId, trackId))
    .orderBy(desc(resistanceBeats.sortOrder), desc(resistanceBeats.id))
    .all()[0]
  return (latest?.sortOrder || 0) + 1
}

export function listTracks(novelId: number): ResistanceTrack[] {
  const db = getDb()
  const context = buildContext(novelId)
  const beatRowsByTrackId = listBeatRowsByTrackId(novelId)
  return db.select().from(resistanceTracks)
    .where(eq(resistanceTracks.novelId, novelId))
    .orderBy(asc(resistanceTracks.resistanceKind), asc(resistanceTracks.id))
    .all()
    .map((row) => buildTrackView(row, context, beatRowsByTrackId.get(row.id) || []))
}

export function getTrack(trackId: number): ResistanceTrack | null {
  const db = getDb()
  const row = db.select().from(resistanceTracks).where(eq(resistanceTracks.id, trackId)).all()[0]
  if (!row) return null
  const context = buildContext(row.novelId)
  const beatRows = db.select().from(resistanceBeats)
    .where(eq(resistanceBeats.trackId, trackId))
    .orderBy(asc(resistanceBeats.sortOrder), asc(resistanceBeats.id))
    .all()
  return buildTrackView(row, context, beatRows)
}

export function upsertTrack(data: ResistanceTrackInput): ResistanceTrack {
  const db = getDb()
  const sourceType = normalizeSourceType(data.sourceType)
  const sourceId = asNumber(data.sourceId)
  const resistanceKind = normalizeKind(data.resistanceKind, sourceType)
  let novelId = data.novelId
  let sourceName = ''

  if (sourceType === 'character' && sourceId) {
    const character = getCharacterById(sourceId)
    novelId = character.novelId
    sourceName = character.fullName
  } else if (sourceType === 'faction' && sourceId) {
    const faction = getFactionById(sourceId)
    novelId = faction.novelId
    sourceName = faction.name
  }

  const current = resolveTrackRow({ ...data, novelId, sourceType, sourceId, resistanceKind })
  const timestamp = new Date().toISOString()
  const defaultTitle = asText(data.title)
    || sourceName
    || (sourceType === 'environment' ? '环境阻力' : sourceType === 'institution' ? '制度阻力' : '阻力线')
  let persistedTrackId = current?.id

  if (current) {
    db.update(resistanceTracks).set({
      sourceType,
      sourceId: sourceId ?? null,
      resistanceKind,
      title: data.title !== undefined ? asText(data.title) || current.title : current.title,
      goal: data.goal !== undefined ? asText(data.goal) : current.goal,
      intelSource: data.intelSource !== undefined ? asText(data.intelSource) : current.intelSource,
      resourcePool: data.resourcePool !== undefined ? asText(data.resourcePool) : current.resourcePool,
      escalationPlan: data.escalationPlan !== undefined ? asText(data.escalationPlan) : current.escalationPlan,
      heroKnowledgeShift: data.heroKnowledgeShift !== undefined ? asText(data.heroKnowledgeShift) : current.heroKnowledgeShift,
      stageVictory: data.stageVictory !== undefined ? asText(data.stageVictory) : current.stageVictory,
      counterMove: data.counterMove !== undefined ? asText(data.counterMove) : current.counterMove,
      currentPressureMode: data.currentPressureMode !== undefined ? asText(data.currentPressureMode) : current.currentPressureMode,
      currentStatus: data.currentStatus !== undefined ? normalizeStatus(data.currentStatus) : normalizeStatus(current.currentStatus),
      lastActionChapterId: data.lastActionChapterId !== undefined ? asNumber(data.lastActionChapterId) ?? null : current.lastActionChapterId,
      nextEscalationChapterId: data.nextEscalationChapterId !== undefined ? asNumber(data.nextEscalationChapterId) ?? null : current.nextEscalationChapterId,
      linkedVolumeId: data.linkedVolumeId !== undefined ? asNumber(data.linkedVolumeId) ?? null : current.linkedVolumeId,
      notes: data.notes !== undefined ? asText(data.notes) : current.notes,
      updatedAt: timestamp,
    }).where(eq(resistanceTracks.id, current.id)).run()
  } else {
    const insertResult = db.insert(resistanceTracks).values({
      novelId,
      sourceType,
      sourceId: sourceId ?? null,
      resistanceKind,
      title: defaultTitle,
      goal: asText(data.goal),
      intelSource: asText(data.intelSource),
      resourcePool: asText(data.resourcePool),
      escalationPlan: asText(data.escalationPlan),
      heroKnowledgeShift: asText(data.heroKnowledgeShift),
      stageVictory: asText(data.stageVictory),
      counterMove: asText(data.counterMove),
      currentPressureMode: asText(data.currentPressureMode),
      currentStatus: normalizeStatus(data.currentStatus),
      lastActionChapterId: asNumber(data.lastActionChapterId) ?? null,
      nextEscalationChapterId: asNumber(data.nextEscalationChapterId) ?? null,
      linkedVolumeId: asNumber(data.linkedVolumeId) ?? null,
      notes: asText(data.notes),
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
    persistedTrackId = Number(insertResult.lastInsertRowid)
  }

  markNovelContextChanged(novelId, 'Resistance tracks changed')
  const tracks = listTracks(novelId)
  const matched = tracks.find((item) => item.id === persistedTrackId)
  if (!matched) throwUserFacingError('common.saveFailed')
  return matched
}

export function upsertBeat(data: ResistanceBeatInput): ResistanceBeat {
  const db = getDb()
  const track = db.select().from(resistanceTracks).where(eq(resistanceTracks.id, data.trackId)).all()[0]
  if (!track) throwUserFacingError('common.notFound')
  const current = data.id
    ? db.select().from(resistanceBeats).where(and(eq(resistanceBeats.id, data.id), eq(resistanceBeats.trackId, data.trackId))).all()[0] || null
    : null
  const timestamp = new Date().toISOString()
  const beatType = normalizeBeatType(data.beatType || current?.beatType)
  const chapterId = data.chapterId !== undefined ? asNumber(data.chapterId) ?? null : current?.chapterId ?? null
  const timelineEventId = data.timelineEventId !== undefined ? asNumber(data.timelineEventId) ?? null : current?.timelineEventId ?? null

  if (current) {
    db.update(resistanceBeats).set({
      beatType,
      chapterId,
      timelineEventId,
      title: data.title !== undefined ? asText(data.title) : current.title,
      summary: data.summary !== undefined ? asText(data.summary) : current.summary,
      actionMode: data.actionMode !== undefined ? asText(data.actionMode) : current.actionMode,
      successLevel: data.successLevel !== undefined ? asText(data.successLevel) : current.successLevel,
      counterResponse: data.counterResponse !== undefined ? asText(data.counterResponse) : current.counterResponse,
      protagonistImpact: data.protagonistImpact !== undefined ? asText(data.protagonistImpact) : current.protagonistImpact,
      status: data.status !== undefined ? asText(data.status) || current.status : current.status,
      sortOrder: data.sortOrder !== undefined ? asNumber(data.sortOrder) ?? current.sortOrder : current.sortOrder,
      updatedAt: timestamp,
    }).where(eq(resistanceBeats.id, current.id)).run()
  } else {
    db.insert(resistanceBeats).values({
      novelId: track.novelId,
      trackId: track.id,
      beatType,
      chapterId,
      timelineEventId,
      title: asText(data.title) || '阻力出手',
      summary: asText(data.summary),
      actionMode: asText(data.actionMode),
      successLevel: asText(data.successLevel),
      counterResponse: asText(data.counterResponse),
      protagonistImpact: asText(data.protagonistImpact),
      status: asText(data.status) || 'logged',
      sortOrder: asNumber(data.sortOrder) ?? getNextBeatSortOrder(track.id),
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  const nextStatus = track.currentStatus === 'resolved'
    ? 'resolved'
    : beatType === 'setback'
      ? 'contained'
      : beatType === 'victory' || beatType === 'strike' || beatType === 'escalation' || beatType === 'counter'
        ? 'active'
        : normalizeStatus(track.currentStatus)

  db.update(resistanceTracks).set({
    lastActionChapterId: chapterId ?? track.lastActionChapterId,
    nextEscalationChapterId: beatType === 'escalation' && chapterId ? chapterId : track.nextEscalationChapterId,
    currentStatus: nextStatus,
    updatedAt: timestamp,
  }).where(eq(resistanceTracks.id, track.id)).run()

  markNovelContextChanged(track.novelId, 'Resistance tracks changed')
  const nextTrack = getTrack(track.id)
  const nextBeat = nextTrack?.beats.find((item) => item.id === data.id) || nextTrack?.beats.at(-1)
  if (!nextBeat) throwUserFacingError('common.saveFailed')
  return nextBeat
}

export function getDashboard(novelId: number): ResistanceDashboard {
  const context = buildContext(novelId)
  const allTracks = listTracks(novelId)
  const characterTracks = allTracks.filter((item) => item.sourceType === 'character')
  const factionTracks = allTracks.filter((item) => item.sourceType === 'faction')
  const environmentTracks = allTracks.filter((item) => item.sourceType === 'environment')
  const institutionTracks = allTracks.filter((item) => item.sourceType === 'institution')

  const availableCharacters = [...context.characterRows]
    .filter((item) => item.roleType === 'antagonist' || characterTracks.some((track) => track.sourceId === item.id))
    .sort(compareCharacters) as Character[]
  const availableFactions = [...context.factionRows].sort(compareFactions) as Faction[]

  return {
    tracks: allTracks,
    characterTracks,
    factionTracks,
    environmentTracks,
    institutionTracks,
    availableCharacters,
    availableFactions,
    chapters: context.chapterRows.map((item) => ({
      id: item.id,
      chapterNum: item.chapterNum,
      title: item.title?.trim() || `第${item.chapterNum}章`,
    })),
    timelineEvents: context.timelineRows.map((item) => ({
      id: item.id,
      eventTitle: item.eventTitle,
      timeLabel: item.timeLabel || '',
      chapterStartId: item.chapterStartId ?? undefined,
      chapterEndId: item.chapterEndId ?? undefined,
    })),
    volumes: context.volumeRows.map((item) => ({
      id: item.id,
      volumeNumber: item.volumeNumber,
      title: item.title?.trim() || `第${item.volumeNumber}卷`,
    })),
    activeTrackCount: allTracks.filter((item) => item.currentStatus === 'active' || item.currentStatus === 'contained').length,
    stalledTrackCount: allTracks.filter((item) => item.currentStatus === 'stalled').length,
    resolvedTrackCount: allTracks.filter((item) => item.currentStatus === 'resolved').length,
  }
}
