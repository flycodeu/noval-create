import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  type StoryMemoryCheckpoint as StoryMemoryCheckpointRow,
  chapters,
  characterRelations,
  characters,
  novels,
  storyItems,
  storyMemoryCheckpoints,
  storyParts,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { ensureStoryStructure } from './story-structure.service'

type StoryMemoryMode = 'standard' | 'longform' | 'epic' | 'mega'
type CheckpointScope = 'novel' | 'volume' | 'part'

export interface StoryMemorySnapshot {
  generatedAt: string
  chapterCount: number
  lastChapterNum: number
  memoryMode: StoryMemoryMode
  coverageSummary: string
  phaseDigest: string[]
  plotMilestones: string[]
  arcSignals: string[]
  characterLedger: string[]
  worldLedger: string[]
  activeThreads: string[]
  continuityDirectives: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

interface ContinuityStateLike {
  plotProgress: string[]
  characterStateChanges: string[]
  worldStateChanges: string[]
  openLoops: string[]
  continuityNotes: string[]
  arcProgress: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
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

function parseContinuityState(raw?: string | null): ContinuityStateLike {
  if (!raw) {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      plotProgress: toStringArray(parsed.plot_progress),
      characterStateChanges: toStringArray(parsed.character_state_changes),
      worldStateChanges: toStringArray(parsed.world_state_changes),
      openLoops: toStringArray(parsed.open_loops),
      continuityNotes: toStringArray(parsed.continuity_notes),
      arcProgress: asText(parsed.arc_progress),
    }
  } catch {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
  }
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

function stringifyStringArray(values: string[]): string {
  return JSON.stringify(dedupe(values))
}

function resolveStoryMemoryMode(targetWords: number, chapterCount: number): StoryMemoryMode {
  if (targetWords >= 1500000 || chapterCount >= 400) return 'mega'
  if (targetWords >= 800000 || chapterCount >= 180) return 'epic'
  if (targetWords >= 350000 || chapterCount >= 80) return 'longform'
  return 'standard'
}

function getModeLimit(mode: StoryMemoryMode, standard: number, longform: number, epic: number, mega?: number): number {
  switch (mode) {
    case 'mega':
      return mega ?? Math.round(epic * 1.4)
    case 'epic':
      return epic
    case 'longform':
      return longform
    default:
      return standard
  }
}

function buildCoverageSummary(
  mode: StoryMemoryMode,
  chapterCount: number,
  lastChapterNum: number,
  targetWords: number,
): string {
  const targetLabel = targetWords > 0 ? `target ${targetWords.toLocaleString()} words` : 'target words not set'
  if (mode === 'mega') {
    return `Mega mode with volume-scoped checkpoints and thread decay. ${chapterCount} chapters covered, latest chapter ${lastChapterNum}, ${targetLabel}.`
  }
  if (mode === 'epic') {
    return `Epic mode with staged checkpoints enabled. ${chapterCount} chapters covered, latest chapter ${lastChapterNum}, ${targetLabel}.`
  }
  if (mode === 'longform') {
    return `Longform mode with staged checkpoints enabled. ${chapterCount} chapters covered, latest chapter ${lastChapterNum}, ${targetLabel}.`
  }
  return `Standard mode. ${chapterCount} chapters covered, latest chapter ${lastChapterNum}, ${targetLabel}.`
}

function buildPhaseDigest(
  rows: Array<{
    chapterNum: number
    summary: string
    continuity: ContinuityStateLike
  }>,
  mode: StoryMemoryMode,
): string[] {
  if (rows.length === 0) return []

  const phaseCount = getModeLimit(mode, 3, 4, 5)
  const chunkSize = Math.max(1, Math.ceil(rows.length / phaseCount))
  const digests: string[] = []

  for (let index = 0; index < phaseCount; index += 1) {
    const chunk = rows.slice(index * chunkSize, (index + 1) * chunkSize)
    if (chunk.length === 0) continue
    const start = chunk[0].chapterNum
    const end = chunk[chunk.length - 1].chapterNum
    const highlights = dedupe([
      ...chunk.map((row) => row.summary).filter(Boolean),
      ...chunk.map((row) => row.continuity.arcProgress).filter(Boolean),
      ...chunk.flatMap((row) => row.continuity.openLoops),
    ], 4)
    digests.push(`Ch.${start}-${end}: ${highlights.join(' | ') || 'checkpoint pending'}`)
  }

  return digests
}

function listRelevantEvents(
  novelId: number,
  chapterStart?: number,
  chapterEnd?: number,
  filters: { volumeId?: number; partId?: number } = {},
) {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const chapterNumById = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  return db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
    .filter((event) => {
      if (filters.partId && event.partId === filters.partId) return true
      if (filters.volumeId && event.volumeId === filters.volumeId) return true
      if (chapterStart === undefined || chapterEnd === undefined) return true
      const start = event.chapterStartId ? chapterNumById.get(event.chapterStartId) : undefined
      const end = event.chapterEndId ? chapterNumById.get(event.chapterEndId) : undefined
      if (typeof start === 'number' && typeof end === 'number') {
        return end >= chapterStart && start <= chapterEnd
      }
      if (typeof start === 'number') return start >= chapterStart && start <= chapterEnd
      if (typeof end === 'number') return end >= chapterStart && end <= chapterEnd
      return false
    })
}

function buildRelationDigest(novelId: number, limit: number): string {
  const db = getDb()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const nameById = new Map(characterRows.map((character) => [character.id, character.fullName]))
  return dedupe(relationRows.map((relation) => {
    const left = nameById.get(relation.charAId) || `#${relation.charAId}`
    const right = nameById.get(relation.charBId) || `#${relation.charBId}`
    const label = relation.relationLabel || relation.relationType || 'linked'
    return `${left} <-> ${right}: ${label}`
  }), limit).join('\n')
}

function buildItemDigest(
  novelId: number,
  eventIds: Set<number>,
  limit: number,
): string {
  const db = getDb()
  const rows = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()

  const preferred = rows.filter((item) =>
    parseNumberArray(item.linkedTimelineEventIdsJson).some((eventId) => eventIds.has(eventId)))
  const selected = (preferred.length > 0 ? preferred : rows.filter((item) => item.itemKind === 'instance')).slice(0, limit)
  return dedupe(selected.map((item) => {
    const parts = [
      item.status || '',
      item.ownerCharacterId ? `owner#${item.ownerCharacterId}` : '',
      item.locationMapId ? `location#${item.locationMapId}` : '',
      item.plotFunction || item.summary || '',
    ].filter(Boolean)
    return `${item.itemName}${parts.length > 0 ? ` | ${parts.join(' | ')}` : ''}`
  }), limit).join('\n')
}

function buildTimelineDigest(
  events: Array<typeof timelineEvents.$inferSelect>,
  limit: number,
): string {
  return dedupe(events.map((event) => {
    const parts = [
      event.timeLabel || '',
      event.eventTitle,
      event.eventResult || event.eventSummary || '',
    ].filter(Boolean)
    return parts.join(' | ')
  }), limit).join('\n')
}

function buildScopeSummary(
  label: string,
  rows: Array<{
    chapterNum: number
    title?: string | null
    summary?: string | null
    continuityStateJson?: string | null
  }>,
  events: Array<typeof timelineEvents.$inferSelect>,
): string {
  const continuityRows = rows.map((row) => ({
    ...row,
    continuity: parseContinuityState(row.continuityStateJson),
  }))
  const summaries = dedupe([
    ...continuityRows.map((row) => asText(row.summary)),
    ...continuityRows.map((row) => row.continuity.arcProgress),
    ...continuityRows.flatMap((row) => row.continuity.plotProgress),
  ], 6)
  const threads = dedupe([
    ...continuityRows.flatMap((row) => row.continuity.openLoops),
    ...events.flatMap((event) => parseStringArray(event.openThreadsJson)),
  ], 5)

  return [
    `${label}: chapters ${rows[0]?.chapterNum || 0}-${rows.at(-1)?.chapterNum || 0}`,
    summaries.length > 0 ? `Highlights: ${summaries.join(' | ')}` : '',
    threads.length > 0 ? `Active threads: ${threads.join(' | ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildForbiddenDirections(): string[] {
  return [
    'Do not invent disconnected jargon or fake literary phrasing.',
    'Do not violate common sense, physical constraints, or ordinary human speech habits.',
    'Do not expand irrelevant subplots that are not tied to the current staged plan.',
    'Keep people, items, and timeline states consistent with prior checkpoints.',
  ]
}

function buildStyleGuard(): string {
  return [
    'Use natural Chinese.',
    'Prefer concrete action, consequence, and dialogue over slogans.',
    'Avoid awkward new words and abstract AI-sounding conclusions.',
    'Every scene should inherit prior state and produce a usable next state.',
  ].join(' ')
}

function upsertCheckpoint(
  novelId: number,
  scopeType: CheckpointScope,
  scopeId: number | null,
  payload: Partial<typeof storyMemoryCheckpoints.$inferInsert>,
) {
  const db = getDb()
  const existing = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
    .find((checkpoint) =>
      checkpoint.scopeType === scopeType
      && ((scopeType === 'novel' && (checkpoint.scopeId ?? null) === null) || checkpoint.scopeId === scopeId))

  if (existing) {
    db.update(storyMemoryCheckpoints).set({
      ...payload,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyMemoryCheckpoints.id, existing.id)).run()
    return existing.id
  }

  const result = db.insert(storyMemoryCheckpoints).values({
    novelId,
    scopeType,
    scopeId,
    ...payload,
  }).run()
  return Number(result.lastInsertRowid)
}

function checkpointsNeedRefresh(novelId: number): boolean {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) return false
  const checkpoints = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
  if (checkpoints.length === 0) return true
  return checkpoints.some((checkpoint) => (checkpoint.version || 1) < (novel.contextVersion || 1) || checkpoint.stale === 1)
}

export function refreshStoryMemoryCheckpoints(novelId: number) {
  ensureStoryStructure(novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('Novel not found')

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const partRows = db.select().from(storyParts)
    .where(eq(storyParts.novelId, novelId))
    .orderBy(asc(storyParts.volumeId), asc(storyParts.partNumber), asc(storyParts.id))
    .all()

  const baseVersion = novel.contextVersion || 1
  const relationDigest = buildRelationDigest(novelId, 10)
  const forbiddenDirectionsJson = stringifyStringArray(buildForbiddenDirections())
  const styleGuard = buildStyleGuard()

  // Skip locked checkpoints (completed volumes in mega mode)
  const existingCheckpoints = db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all()
  for (const checkpoint of existingCheckpoints) {
    if (checkpoint.locked === 1) continue
    db.update(storyMemoryCheckpoints).set({
      stale: 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyMemoryCheckpoints.id, checkpoint.id)).run()
  }

  const upsertScope = (
    scopeType: CheckpointScope,
    scopeId: number | null,
    label: string,
    rows: typeof chapterRows,
  ) => {
    const start = rows[0]?.chapterNum ?? 0
    const end = rows.at(-1)?.chapterNum ?? 0
    const events = listRelevantEvents(novelId, start || undefined, end || undefined)
    const eventIds = new Set(events.map((event) => event.id))
    const continuityRows = rows.map((row) => ({
      ...row,
      continuity: parseContinuityState(row.continuityStateJson),
    }))
    const resolvedThreads = dedupe(events
      .filter((event) => event.status === 'resolved')
      .map((event) => event.eventTitle), 12)
    const activeThreads = dedupe([
      ...continuityRows.flatMap((row) => row.continuity.openLoops),
      ...events.flatMap((event) => parseStringArray(event.openThreadsJson)),
    ], 18)
    const characterStateDigest = dedupe(
      continuityRows.flatMap((row) => row.continuity.characterStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
      16,
    ).join('\n')
    const timelineDigest = buildTimelineDigest(events, 14)
    const itemDigest = buildItemDigest(novelId, eventIds, 14)

    upsertCheckpoint(novelId, scopeType, scopeId, {
      label,
      summary: buildScopeSummary(label, rows, events),
      resolvedThreadsJson: stringifyStringArray(resolvedThreads),
      activeThreadsJson: stringifyStringArray(activeThreads),
      characterStateDigest,
      relationDigest,
      itemDigest,
      timelineDigest,
      forbiddenDirectionsJson,
      styleGuard,
      sourceRangeStart: start || null,
      sourceRangeEnd: end || null,
      lastRefreshedChapterNum: end || 0,
      version: baseVersion,
      stale: 0,
    })
  }

  upsertScope('novel', null, novel.title, chapterRows)

  for (const volume of volumeRows) {
    const rows = chapterRows.filter((chapter) => chapter.volumeId === volume.id)
    const start = rows[0]?.chapterNum ?? 0
    const end = rows.at(-1)?.chapterNum ?? 0
    const events = listRelevantEvents(novelId, start || undefined, end || undefined, { volumeId: volume.id })
    upsertCheckpoint(novelId, 'volume', volume.id, {
      label: volume.title?.trim() || `第${volume.volumeNumber}卷`,
      summary: buildScopeSummary(volume.title?.trim() || `第${volume.volumeNumber}卷`, rows, events),
      resolvedThreadsJson: stringifyStringArray(dedupe(events.filter((event) => event.status === 'resolved').map((event) => event.eventTitle), 12)),
      activeThreadsJson: stringifyStringArray(dedupe([
        ...rows.map((row) => ({ ...row, continuity: parseContinuityState(row.continuityStateJson) })).flatMap((row) => row.continuity.openLoops),
        ...events.flatMap((event) => parseStringArray(event.openThreadsJson)),
      ], 18)),
      characterStateDigest: dedupe(
        rows
          .map((row) => ({ ...row, continuity: parseContinuityState(row.continuityStateJson) }))
          .flatMap((row) => row.continuity.characterStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
        16,
      ).join('\n'),
      relationDigest,
      itemDigest: buildItemDigest(novelId, new Set(events.map((event) => event.id)), 14),
      timelineDigest: buildTimelineDigest(events, 14),
      forbiddenDirectionsJson,
      styleGuard,
      sourceRangeStart: start || null,
      sourceRangeEnd: end || null,
      lastRefreshedChapterNum: end || 0,
      version: baseVersion,
      stale: 0,
    })

    // In mega mode, lock completed volume checkpoints to avoid re-processing
    const memoryMode = resolveStoryMemoryMode(novel.targetWords || 0, chapterRows.length)
    if (memoryMode === 'mega' && rows.length > 0 && rows.every((row) => (row.wordCount || 0) > 0 && row.status === 'completed')) {
      const existing = db.select().from(storyMemoryCheckpoints)
        .where(eq(storyMemoryCheckpoints.novelId, novelId))
        .all()
        .find((cp) => cp.scopeType === 'volume' && cp.scopeId === volume.id)
      if (existing) {
        db.update(storyMemoryCheckpoints).set({ locked: 1 }).where(eq(storyMemoryCheckpoints.id, existing.id)).run()
      }
    }
  }

  for (const part of partRows) {
    const rows = chapterRows.filter((chapter) => chapter.partId === part.id)
    const start = rows[0]?.chapterNum ?? 0
    const end = rows.at(-1)?.chapterNum ?? 0
    const events = listRelevantEvents(novelId, start || undefined, end || undefined, { partId: part.id })
    upsertCheckpoint(novelId, 'part', part.id, {
      label: part.title?.trim() || `第${part.partNumber}部`,
      summary: buildScopeSummary(part.title?.trim() || `第${part.partNumber}部`, rows, events),
      resolvedThreadsJson: stringifyStringArray(dedupe(events.filter((event) => event.status === 'resolved').map((event) => event.eventTitle), 12)),
      activeThreadsJson: stringifyStringArray(dedupe([
        ...rows.map((row) => ({ ...row, continuity: parseContinuityState(row.continuityStateJson) })).flatMap((row) => row.continuity.openLoops),
        ...events.flatMap((event) => parseStringArray(event.openThreadsJson)),
      ], 18)),
      characterStateDigest: dedupe(
        rows
          .map((row) => ({ ...row, continuity: parseContinuityState(row.continuityStateJson) }))
          .flatMap((row) => row.continuity.characterStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
        16,
      ).join('\n'),
      relationDigest,
      itemDigest: buildItemDigest(novelId, new Set(events.map((event) => event.id)), 14),
      timelineDigest: buildTimelineDigest(events, 14),
      forbiddenDirectionsJson,
      styleGuard,
      sourceRangeStart: start || null,
      sourceRangeEnd: end || null,
      lastRefreshedChapterNum: end || 0,
      version: baseVersion,
      stale: 0,
    })
  }

  return db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .orderBy(asc(storyMemoryCheckpoints.scopeType), asc(storyMemoryCheckpoints.scopeId), asc(storyMemoryCheckpoints.id))
    .all()
}

function ensureFreshCheckpoints(novelId: number) {
  if (checkpointsNeedRefresh(novelId)) {
    refreshStoryMemoryCheckpoints(novelId)
  }
}

export function buildStoryMemorySnapshot(novelId: number): StoryMemorySnapshot {
  ensureFreshCheckpoints(novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const eventRows = listRelevantEvents(novelId)

  const continuityRows = chapterRows.map((chapter) => ({
    chapterNum: chapter.chapterNum,
    summary: asText(chapter.summary),
    continuity: parseContinuityState(chapter.continuityStateJson),
  }))
  const targetWords = novel?.targetWords || 0
  const lastChapterNum = chapterRows.at(-1)?.chapterNum || 0
  const memoryMode = resolveStoryMemoryMode(targetWords, chapterRows.length)
  const checkpoints = db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all()
  const partDigests = checkpoints
    .filter((checkpoint) => checkpoint.scopeType === 'part' && checkpoint.summary)
    .map((checkpoint) => checkpoint.summary || '')
  const volumeDigests = checkpoints
    .filter((checkpoint) => checkpoint.scopeType === 'volume' && checkpoint.summary)
    .map((checkpoint) => checkpoint.summary || '')

  // In mega mode, apply thread decay: filter out open loops from chapters older than 150 chapters
  const threadDecayThreshold = memoryMode === 'mega' ? 150 : Infinity
  const recentContinuityRows = threadDecayThreshold < Infinity
    ? continuityRows.filter((row) => lastChapterNum - row.chapterNum < threadDecayThreshold)
    : continuityRows

  return {
    generatedAt: new Date().toISOString(),
    chapterCount: chapterRows.length,
    lastChapterNum,
    memoryMode,
    coverageSummary: buildCoverageSummary(memoryMode, chapterRows.length, lastChapterNum, targetWords),
    phaseDigest: dedupe([
      ...partDigests.slice(0, 3),
      ...volumeDigests.slice(0, 2),
      ...buildPhaseDigest(continuityRows, memoryMode),
    ], getModeLimit(memoryMode, 6, 8, 10, 14)),
    plotMilestones: dedupe([
      ...continuityRows.map((row) => row.summary ? `Ch.${row.chapterNum}: ${row.summary}` : '').filter(Boolean),
      ...continuityRows.flatMap((row) => row.continuity.plotProgress.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
    ], getModeLimit(memoryMode, 12, 16, 20)),
    arcSignals: dedupe(continuityRows.map((row) =>
      row.continuity.arcProgress ? `Ch.${row.chapterNum}: ${row.continuity.arcProgress}` : '').filter(Boolean),
    getModeLimit(memoryMode, 10, 14, 18)),
    characterLedger: dedupe(
      continuityRows.flatMap((row) => row.continuity.characterStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
      getModeLimit(memoryMode, 12, 16, 20),
    ),
    worldLedger: dedupe(
      continuityRows.flatMap((row) => row.continuity.worldStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
      getModeLimit(memoryMode, 10, 14, 18),
    ),
    activeThreads: dedupe([
      ...recentContinuityRows.flatMap((row) => row.continuity.openLoops),
      ...eventRows.flatMap((event) => parseStringArray(event.openThreadsJson)),
    ], getModeLimit(memoryMode, 14, 18, 24, 32)),
    continuityDirectives: dedupe(
      continuityRows.flatMap((row) => row.continuity.continuityNotes),
      getModeLimit(memoryMode, 12, 16, 20),
    ),
    timelineAnchors: dedupe(
      eventRows.map((event) => `${event.timeLabel || 'TBD'} | ${event.eventTitle} | ${event.eventResult || event.eventSummary || ''}`),
      getModeLimit(memoryMode, 10, 14, 18),
    ),
    itemLedger: dedupe(
      db.select().from(storyItems)
        .where(eq(storyItems.novelId, novelId))
        .all()
        .filter((item) => item.itemKind === 'instance')
        .map((item) => `${item.itemName} | ${item.status || ''} | ${item.plotFunction || item.summary || ''}`),
      getModeLimit(memoryMode, 10, 14, 18),
    ),
  }
}

export function buildStoryMemoryPromptSummary(
  novelId: number,
  options: { chapterId?: number } = {},
): string {
  ensureFreshCheckpoints(novelId)
  const db = getDb()
  const chapter = options.chapterId
    ? db.select().from(chapters).where(eq(chapters.id, options.chapterId)).all()[0]
    : null
  const checkpointRows = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
  const partCheckpoint = chapter?.partId
    ? checkpointRows.find((checkpoint) => checkpoint.scopeType === 'part' && checkpoint.scopeId === chapter.partId)
    : null
  const volumeCheckpoint = chapter?.volumeId
    ? checkpointRows.find((checkpoint) => checkpoint.scopeType === 'volume' && checkpoint.scopeId === chapter.volumeId)
    : null
  const novelCheckpoint = checkpointRows.find((checkpoint) => checkpoint.scopeType === 'novel')

  const sections = [partCheckpoint, volumeCheckpoint, novelCheckpoint]
    .filter((checkpoint): checkpoint is StoryMemoryCheckpointRow => Boolean(checkpoint))
    .map((checkpoint) => {
      const activeThreads = parseStringArray(checkpoint.activeThreadsJson)
      const resolvedThreads = parseStringArray(checkpoint.resolvedThreadsJson)
      return [
        checkpoint.label ? `[${checkpoint.label}]` : '',
        checkpoint.summary || '',
        checkpoint.characterStateDigest ? `Character states:\n${checkpoint.characterStateDigest}` : '',
        checkpoint.relationDigest ? `Relations:\n${checkpoint.relationDigest}` : '',
        checkpoint.itemDigest ? `Items:\n${checkpoint.itemDigest}` : '',
        checkpoint.timelineDigest ? `Timeline:\n${checkpoint.timelineDigest}` : '',
        activeThreads.length > 0 ? `Active threads:\n- ${activeThreads.join('\n- ')}` : '',
        resolvedThreads.length > 0 ? `Resolved threads:\n- ${resolvedThreads.join('\n- ')}` : '',
        checkpoint.styleGuard ? `Style guard: ${checkpoint.styleGuard}` : '',
      ].filter(Boolean).join('\n\n')
    })

  if (sections.length > 0) {
    return sections.join('\n\n')
  }

  const snapshot = buildStoryMemorySnapshot(novelId)
  return [
    snapshot.coverageSummary,
    snapshot.phaseDigest.length > 0 ? `Phase digest:\n- ${snapshot.phaseDigest.join('\n- ')}` : '',
    snapshot.plotMilestones.length > 0 ? `Milestones:\n- ${snapshot.plotMilestones.join('\n- ')}` : '',
    snapshot.activeThreads.length > 0 ? `Open threads:\n- ${snapshot.activeThreads.join('\n- ')}` : '',
    snapshot.timelineAnchors.length > 0 ? `Timeline anchors:\n- ${snapshot.timelineAnchors.join('\n- ')}` : '',
    snapshot.itemLedger.length > 0 ? `Item ledger:\n- ${snapshot.itemLedger.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n')
}
