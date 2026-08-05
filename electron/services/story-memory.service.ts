import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  type StoryMemoryCheckpoint as StoryMemoryCheckpointRow,
  chapters,
  characterRelations,
  characters,
  novels,
  storyArcs,
  storyItems,
  storyMemoryCheckpoints,
  storyParts,
  storyThreads,
  storyVolumes,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { markStoryMemoryCheckpointsDirty } from './context-impact.service'
import { ensureStoryStructure } from './story-structure.service'
import {
  buildCharacterContextCards,
  buildRelationContextCards,
  buildItemContextCards,
  buildTimelineContextCards,
  buildScopeThreadContextCards,
  buildGenericThreadCardsFromTexts,
  parseCharacterCards,
  parseRelationCards,
  parseItemCards,
  parseTimelineCards,
  parseThreadCards,
  parseCardStringArray,
  renderCharacterCards,
  renderRelationCards,
  renderItemCards,
  renderTimelineCards,
  renderThreadCards,
  stringifyCharacterCards,
  stringifyRelationCards,
  stringifyItemCards,
  stringifyTimelineCards,
  stringifyThreadCards,
} from './context-cards'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  type CharacterStateDriftAlert,
  type CharacterStateSummary,
  listLatestCharacterStates,
  listNovelCharacterStateAlerts,
} from './character-state.service'
import {
  type WorldStateAlert,
  type WorldStateLedgerConflictEntity,
  type WorldStateLedgerOverview,
  type WorldStateSummary,
  getWorldStateLedgerSnapshot,
} from './world-state.service'

const CHECKPOINT_CHAPTER_REFRESH_INTERVAL = 30
const CHECKPOINT_TIME_REFRESH_MS = 7 * 24 * 60 * 60 * 1000
const storyMemoryRefreshPending = new Set<number>()
const storyMemoryRefreshStatus = new Map<number, {
  status: 'idle' | 'queued' | 'running' | 'failed'
  queuedAt?: string
  startedAt?: string
  finishedAt?: string
  lastError?: string
  reason?: string
  trigger?: string
}>()

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
  characterCurrentStates: CharacterStateSummary[]
  characterStateAlerts: CharacterStateDriftAlert[]
  worldCurrentStates: WorldStateSummary[]
  worldStateAlerts: WorldStateAlert[]
  worldStateOverview: WorldStateLedgerOverview
  worldConflictEntities: WorldStateLedgerConflictEntity[]
  characterStateTrendSummary: string[]
  worldStateTrendSummary: string[]
  worldLedger: string[]
  activeThreads: string[]
  continuityDirectives: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

type StoryMemoryCheckpointScope = 'novel' | 'volume' | 'part'

export interface StoryMemoryPromptScopeObservability {
  scopeType: StoryMemoryCheckpointScope
  label: string
  hasCheckpoint: boolean
  structuredFamilyCount: number
  fallbackFamilyCount: number
  missingFamilyCount: number
  cardCoverageRate: number
  usesTextFallback: boolean
}

export interface StoryMemoryPromptObservability {
  promptSummaryMode: 'structured_first'
  activeScopeLabels: string[]
  scopeCoverageRate: number
  cardCoverageRate: number
  structuredScopeCount: number
  fallbackScopeCount: number
  buckets: StoryMemoryPromptScopeObservability[]
  summary: string
}

export interface StoryMemoryPromptPackage {
  summary: string
  observability: StoryMemoryPromptObservability
}

export interface StoryMemoryCheckpointRefreshStatus {
  status: 'idle' | 'queued' | 'running' | 'failed'
  queuedAt?: string
  startedAt?: string
  finishedAt?: string
  lastError?: string
  reason?: string
  trigger?: string
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

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
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
  // 只取 id/章号做映射，避免长篇场景把全部章节正文加载进内存
  const chapterRows = db.select({ id: chapters.id, chapterNum: chapters.chapterNum }).from(chapters)
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
    `${label}：第 ${rows[0]?.chapterNum || 0} 章到第 ${rows.at(-1)?.chapterNum || 0} 章`,
    summaries.length > 0 ? `关键进展：${summaries.join(' | ')}` : '',
    threads.length > 0 ? `活跃线程：${threads.join(' | ')}` : '',
  ].filter(Boolean).join('\n')
}

function buildForbiddenDirections(): string[] {
  return [
    '不要发明和当前小说无关的黑话、术语或伪文艺说法。',
    '不要违反常识、物理约束或正常中文表达习惯。',
    '不要扩写与当前阶段计划无关的旁支情节。',
    '人物、物品和时间轴状态必须与前序检查点保持一致。',
  ]
}

function buildStyleGuard(): string {
  return [
    '使用自然中文。',
    '优先保留具体动作、后果和对白，不要写成口号句。',
    '避免生造词、翻译腔和抽象的 AI 式结论。',
    '每个场景都要继承前序状态，并产出可继续调用的下一状态。',
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
  if (checkpoints.some((checkpoint) => (checkpoint.version || 1) < (novel.contextVersion || 1) || checkpoint.stale === 1)) {
    return true
  }
  if (checkpoints.some((checkpoint) =>
    !checkpoint.characterCardsJson
    || !checkpoint.relationCardsJson
    || !checkpoint.itemCardsJson
    || !checkpoint.timelineCardsJson
    || !checkpoint.threadCardsJson)) {
    return true
  }

  const latestChapterNum = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .at(-1)?.chapterNum || 0
  const novelCheckpoint = checkpoints.find((checkpoint) =>
    checkpoint.scopeType === 'novel' && (checkpoint.scopeId ?? null) === null)
  if (!novelCheckpoint) return true

  if (
    latestChapterNum > 0
    && latestChapterNum - (novelCheckpoint.lastRefreshedChapterNum || 0) >= CHECKPOINT_CHAPTER_REFRESH_INTERVAL
  ) {
    markStoryMemoryCheckpointsDirty(novelId)
    return true
  }

  const refreshedAt = Date.parse(novelCheckpoint.updatedAt || novelCheckpoint.createdAt || '')
  if (!Number.isFinite(refreshedAt)) {
    markStoryMemoryCheckpointsDirty(novelId)
    return true
  }

  if (Date.now() - refreshedAt >= CHECKPOINT_TIME_REFRESH_MS) {
    markStoryMemoryCheckpointsDirty(novelId)
    return true
  }

  return false
}

export function refreshStoryMemoryCheckpoints(novelId: number) {
  ensureStoryStructure(novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

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
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
  const threadRows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()

  const baseVersion = novel.contextVersion || 1
  const forbiddenDirectionsJson = stringifyStringArray(buildForbiddenDirections())
  const styleGuard = buildStyleGuard()
  const characterNameMap = new Map(characterRows.map((character) => [character.id, character.fullName]))
  const locationNameMap = new Map(mapRows.map((row) => [row.id, row.name]))
  const chapterNumMap = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const arcNameMap = new Map(arcRows.map((arc) => [arc.id, arc.arcName]))

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
    filters: { volumeId?: number; partId?: number } = {},
  ) => {
    const start = rows[0]?.chapterNum ?? 0
    const end = rows.at(-1)?.chapterNum ?? 0
    const events = listRelevantEvents(novelId, start || undefined, end || undefined, filters)
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
    const summary = buildScopeSummary(label, rows, events)
    const characterCards = buildCharacterContextCards({
      allCharacters: characterRows,
      relationRows,
      recentStateEntries: continuityRows.flatMap((row) =>
        row.continuity.characterStateChanges.map((entry) => ({
          chapterNum: row.chapterNum,
          entry,
        }))),
      limit: 12,
    })
    const relationCards = buildRelationContextCards({
      allCharacters: characterRows,
      relationRows,
      focusText: [summary, ...rows.map((row) => asText(row.summary)), ...activeThreads].filter(Boolean).join('\n'),
      limit: 10,
    })
    const itemCards = buildItemContextCards({
      items: itemRows,
      characterNameMap,
      locationNameMap,
      preferredEventIds: eventIds,
      limit: 14,
    })
    const timelineCards = buildTimelineContextCards(events, {
      chapterNumMap,
      arcNameMap,
      characterNameMap,
      locationNameMap,
    }, 14)
    const threadCards = buildScopeThreadContextCards({
      threads: threadRows,
      startChapter: start || undefined,
      endChapter: end || undefined,
      extraThreadNames: activeThreads,
      limit: 12,
    })

    upsertCheckpoint(novelId, scopeType, scopeId, {
      label,
      summary,
      resolvedThreadsJson: stringifyStringArray(resolvedThreads),
      activeThreadsJson: stringifyStringArray(activeThreads),
      characterCardsJson: stringifyCharacterCards(characterCards),
      relationCardsJson: stringifyRelationCards(relationCards),
      itemCardsJson: stringifyItemCards(itemCards),
      timelineCardsJson: stringifyTimelineCards(timelineCards),
      threadCardsJson: stringifyThreadCards(threadCards),
      characterStateDigest: renderCharacterCards(characterCards),
      relationDigest: renderRelationCards(relationCards),
      itemDigest: renderItemCards(itemCards),
      timelineDigest: renderTimelineCards(timelineCards),
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
    upsertScope('volume', volume.id, volume.title?.trim() || `第${volume.volumeNumber}卷`, rows, { volumeId: volume.id })

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
    upsertScope('part', part.id, part.title?.trim() || `第${part.partNumber}部`, rows, { partId: part.id })
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

function setStoryMemoryRefreshStatus(
  novelId: number,
  next: Partial<StoryMemoryCheckpointRefreshStatus> & { status: StoryMemoryCheckpointRefreshStatus['status'] },
) {
  const current = storyMemoryRefreshStatus.get(novelId) || { status: 'idle' as const }
  storyMemoryRefreshStatus.set(novelId, {
    ...current,
    ...next,
  })
}

export function scheduleStoryMemoryCheckpointRefresh(novelId: number, reason = 'checkpoint stale', trigger = 'background_precompute') {
  const now = new Date().toISOString()
  if (storyMemoryRefreshPending.has(novelId)) {
    setStoryMemoryRefreshStatus(novelId, {
      status: 'queued',
      queuedAt: now,
      reason,
      trigger,
    })
    return
  }
  storyMemoryRefreshPending.add(novelId)
  setStoryMemoryRefreshStatus(novelId, {
    status: 'queued',
    queuedAt: now,
    reason,
    trigger,
    lastError: undefined,
  })
  void (async () => {
    const startedAt = new Date().toISOString()
    setStoryMemoryRefreshStatus(novelId, {
      status: 'running',
      startedAt,
      reason,
      trigger,
      lastError: undefined,
    })
    try {
      await Promise.resolve(refreshStoryMemoryCheckpoints(novelId))
      setStoryMemoryRefreshStatus(novelId, {
        status: 'idle',
        finishedAt: new Date().toISOString(),
        reason,
        trigger,
        lastError: undefined,
      })
    } catch (error) {
      setStoryMemoryRefreshStatus(novelId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        reason,
        trigger,
        lastError: error instanceof Error ? error.message : 'story memory checkpoint refresh failed',
      })
      console.warn('[story-memory] failed to refresh checkpoints in background', error)
    } finally {
      storyMemoryRefreshPending.delete(novelId)
    }
  })()
}

export function getStoryMemoryCheckpointRefreshStatus(novelId: number): StoryMemoryCheckpointRefreshStatus {
  return storyMemoryRefreshStatus.get(novelId) || { status: 'idle' }
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
  const characterCurrentStates = listLatestCharacterStates(novelId, { limit: getModeLimit(memoryMode, 6, 8, 10, 12) })
  const characterStateAlerts = listNovelCharacterStateAlerts(novelId, getModeLimit(memoryMode, 3, 4, 5, 6))
  const worldStateLedger = getWorldStateLedgerSnapshot(novelId, {
    entityLimit: getModeLimit(memoryMode, 6, 8, 10, 12),
    alertLimit: getModeLimit(memoryMode, 4, 5, 6, 8),
    conflictEntityLimit: getModeLimit(memoryMode, 4, 5, 6, 8),
  })
  const worldCurrentStates = worldStateLedger.entities
  const worldStateAlerts = worldStateLedger.alerts
  const checkpoints = db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all()
  const partDigests = checkpoints
    .filter((checkpoint) => checkpoint.scopeType === 'part' && checkpoint.summary)
    .map((checkpoint) => checkpoint.summary || '')
  const volumeDigests = checkpoints
    .filter((checkpoint) => checkpoint.scopeType === 'volume' && checkpoint.summary)
    .map((checkpoint) => checkpoint.summary || '')

  // Hierarchical memory decay: limit detailed chapter events, relying on volume/part digests for the past
  const threadDecayThreshold = memoryMode === 'mega' ? 150 : memoryMode === 'epic' ? 250 : memoryMode === 'longform' ? 400 : Infinity
  const detailDecayThreshold = memoryMode === 'mega' ? 80 : memoryMode === 'epic' ? 150 : memoryMode === 'longform' ? 250 : Infinity

  const recentContinuityRows = threadDecayThreshold < Infinity
    ? continuityRows.filter((row) => lastChapterNum - row.chapterNum <= threadDecayThreshold)
    : continuityRows

  const detailedContinuityRows = detailDecayThreshold < Infinity
    ? continuityRows.filter((row) => lastChapterNum - row.chapterNum <= detailDecayThreshold)
    : continuityRows

  return {
    generatedAt: new Date().toISOString(),
    chapterCount: chapterRows.length,
    lastChapterNum,
    memoryMode,
    coverageSummary: buildCoverageSummary(memoryMode, chapterRows.length, lastChapterNum, targetWords),
    phaseDigest: dedupe([
      ...partDigests.slice(0, 3),
      ...volumeDigests.slice(0, 3),
      ...buildPhaseDigest(detailedContinuityRows, memoryMode),
    ], getModeLimit(memoryMode, 6, 8, 10, 14)),
    plotMilestones: dedupe([
      ...detailedContinuityRows.map((row) => row.summary ? `Ch.${row.chapterNum}: ${row.summary}` : '').filter(Boolean),
      ...detailedContinuityRows.flatMap((row) => row.continuity.plotProgress.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
    ], getModeLimit(memoryMode, 12, 16, 20)),
      arcSignals: dedupe(detailedContinuityRows.map((row) =>
        row.continuity.arcProgress ? `Ch.${row.chapterNum}: ${row.continuity.arcProgress}` : '').filter(Boolean),
      getModeLimit(memoryMode, 10, 14, 18)),
      characterLedger: dedupe(
        detailedContinuityRows.flatMap((row) => row.continuity.characterStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
        getModeLimit(memoryMode, 12, 16, 20),
      ),
      characterCurrentStates,
      characterStateAlerts,
      worldCurrentStates,
      worldStateAlerts,
      worldStateOverview: worldStateLedger.overview,
      worldConflictEntities: worldStateLedger.conflictEntities,
      characterStateTrendSummary: characterStateAlerts.map((item) => `第${item.chapterNum}章 · ${item.summary}`),
      worldStateTrendSummary: worldStateLedger.trendSummary,
      worldLedger: dedupe(
        [
          ...detailedContinuityRows.flatMap((row) => row.continuity.worldStateChanges.map((entry) => `Ch.${row.chapterNum}: ${entry}`)),
          ...worldCurrentStates.map((item) => `Ch.${item.chapterNum}: ${entityLabel(item)} ${item.entityName} · ${item.summaryText}`),
          ...worldStateLedger.conflictEntities.map((item) => `冲突 ${entityLabel(item)} ${item.entityName} · ${item.reasons.join('；')}`),
        ],
        getModeLimit(memoryMode, 10, 14, 18),
      ),
    activeThreads: dedupe([
      ...recentContinuityRows.flatMap((row) => row.continuity.openLoops),
      ...eventRows.flatMap((event) => parseStringArray(event.openThreadsJson)),
    ], getModeLimit(memoryMode, 14, 18, 24, 32)),
    continuityDirectives: dedupe(
      recentContinuityRows.flatMap((row) => row.continuity.continuityNotes),
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
  options: { chapterId?: number; refreshMode?: 'sync' | 'schedule_only' } = {},
): string {
  return buildStoryMemoryPromptPackage(novelId, options).summary
}

export function buildStoryMemoryPromptPackage(
  novelId: number,
  options: { chapterId?: number; refreshMode?: 'sync' | 'schedule_only' } = {},
): StoryMemoryPromptPackage {
  const refreshMode = options.refreshMode || 'sync'
  if (refreshMode === 'sync') {
    ensureFreshCheckpoints(novelId)
  } else if (checkpointsNeedRefresh(novelId)) {
    scheduleStoryMemoryCheckpointRefresh(novelId, 'checkpoint stale during story memory prompt build', 'story_memory_prompt')
  }
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
  const renderList = (label: string, values: string[]) => values.length > 0 ? `${label}：\n- ${values.join('\n- ')}` : ''
  const scopeObservability: StoryMemoryPromptScopeObservability[] = []
  const sections = [partCheckpoint, volumeCheckpoint, novelCheckpoint]
    .filter((checkpoint): checkpoint is StoryMemoryCheckpointRow => Boolean(checkpoint))
    .map((checkpoint) => {
      const activeThreads = parseCardStringArray(checkpoint.activeThreadsJson)
      const resolvedThreads = parseCardStringArray(checkpoint.resolvedThreadsJson)
      const characterCardsText = renderCharacterCards(parseCharacterCards(checkpoint.characterCardsJson))
      const relationCardsText = renderRelationCards(parseRelationCards(checkpoint.relationCardsJson))
      const itemCardsText = renderItemCards(parseItemCards(checkpoint.itemCardsJson))
      const timelineCardsText = renderTimelineCards(parseTimelineCards(checkpoint.timelineCardsJson))
      const directThreadCardsText = renderThreadCards(parseThreadCards(checkpoint.threadCardsJson))
      const fallbackThreadCardsText = directThreadCardsText
        ? ''
        : renderThreadCards(buildGenericThreadCardsFromTexts(activeThreads, '待持续追踪', 12))
      const threadCardsText = directThreadCardsText || fallbackThreadCardsText
      const structuredFamilyCount = [
        Boolean(characterCardsText),
        Boolean(relationCardsText),
        Boolean(itemCardsText),
        Boolean(timelineCardsText),
        Boolean(directThreadCardsText),
      ].filter(Boolean).length
      const fallbackFamilyCount = [
        !characterCardsText && Boolean(checkpoint.characterStateDigest),
        !relationCardsText && Boolean(checkpoint.relationDigest),
        !itemCardsText && Boolean(checkpoint.itemDigest),
        !timelineCardsText && Boolean(checkpoint.timelineDigest),
        !directThreadCardsText && Boolean(fallbackThreadCardsText),
      ].filter(Boolean).length
      const missingFamilyCount = 5 - structuredFamilyCount - fallbackFamilyCount
      scopeObservability.push({
        scopeType: checkpoint.scopeType as StoryMemoryCheckpointScope,
        label: checkpoint.label || checkpoint.scopeType,
        hasCheckpoint: true,
        structuredFamilyCount,
        fallbackFamilyCount,
        missingFamilyCount,
        cardCoverageRate: toPercent(structuredFamilyCount, 5),
        usesTextFallback: fallbackFamilyCount > 0,
      })
      return [
        checkpoint.label ? `[${checkpoint.label}]` : '',
        checkpoint.summary ? `摘要：${checkpoint.summary}` : '',
        characterCardsText ? `人物卡：\n${characterCardsText}` : checkpoint.characterStateDigest ? `人物卡：\n${checkpoint.characterStateDigest}` : '',
        relationCardsText ? `关系卡：\n${relationCardsText}` : checkpoint.relationDigest ? `关系卡：\n${checkpoint.relationDigest}` : '',
        itemCardsText ? `物品卡：\n${itemCardsText}` : checkpoint.itemDigest ? `物品卡：\n${checkpoint.itemDigest}` : '',
        timelineCardsText ? `时间卡：\n${timelineCardsText}` : checkpoint.timelineDigest ? `时间卡：\n${checkpoint.timelineDigest}` : '',
        threadCardsText ? `线程卡：\n${threadCardsText}` : '',
        renderList('已回收线程', resolvedThreads),
        checkpoint.styleGuard ? `文风护栏：${checkpoint.styleGuard}` : '',
      ].filter(Boolean).join('\n')
    })

  const activeScopes: StoryMemoryCheckpointScope[] = []
  if (partCheckpoint) activeScopes.push('part')
  if (volumeCheckpoint) activeScopes.push('volume')
  activeScopes.push('novel')
  for (const scopeType of activeScopes) {
    if (scopeObservability.some((item) => item.scopeType === scopeType)) continue
    scopeObservability.push({
      scopeType,
      label: scopeType === 'part' ? '当前 part' : scopeType === 'volume' ? '当前 volume' : '全书',
      hasCheckpoint: false,
      structuredFamilyCount: 0,
      fallbackFamilyCount: 0,
      missingFamilyCount: 5,
      cardCoverageRate: 0,
      usesTextFallback: false,
    })
  }
  const structuredFamilyTotal = scopeObservability.reduce((sum, item) => sum + item.structuredFamilyCount, 0)
  const observability: StoryMemoryPromptObservability = {
    promptSummaryMode: 'structured_first',
    activeScopeLabels: scopeObservability.filter((item) => item.hasCheckpoint).map((item) => item.label),
    scopeCoverageRate: toPercent(scopeObservability.filter((item) => item.hasCheckpoint).length, scopeObservability.length || 1),
    cardCoverageRate: toPercent(structuredFamilyTotal, Math.max(scopeObservability.length * 5, 1)),
    structuredScopeCount: scopeObservability.filter((item) => item.structuredFamilyCount > 0).length,
    fallbackScopeCount: scopeObservability.filter((item) => item.usesTextFallback).length,
    buckets: scopeObservability,
    summary: scopeObservability.length > 0
      ? `结构化 checkpoint 命中 ${scopeObservability.filter((item) => item.hasCheckpoint).length}/${scopeObservability.length} 个 scope，卡片覆盖 ${toPercent(structuredFamilyTotal, Math.max(scopeObservability.length * 5, 1))}%，文本 fallback ${scopeObservability.filter((item) => item.usesTextFallback).length} 个 scope。`
      : '当前还没有可用的结构化 checkpoint 观测数据。',
  }

  if (sections.length > 0) {
    return {
      summary: sections.join('\n\n'),
      observability,
    }
  }

  const snapshot = buildStoryMemorySnapshot(novelId)
  return {
    summary: [
      snapshot.coverageSummary,
      snapshot.phaseDigest.length > 0 ? `阶段摘要：\n- ${snapshot.phaseDigest.join('\n- ')}` : '',
      snapshot.plotMilestones.length > 0 ? `剧情里程碑：\n- ${snapshot.plotMilestones.join('\n- ')}` : '',
      snapshot.characterCurrentStates.length > 0
      ? `角色当前状态：\n- ${snapshot.characterCurrentStates.map((item) => `${item.characterName}：${item.summaryText}`).join('\n- ')}`
      : '',
      snapshot.characterStateAlerts.length > 0
      ? `角色状态漂移告警：\n- ${snapshot.characterStateAlerts.map((item) => item.summary).join('\n- ')}`
      : '',
      snapshot.worldCurrentStates.length > 0
      ? `世界当前状态：\n- ${snapshot.worldCurrentStates.map((item) => `${entityLabel(item)} ${item.entityName}：${item.summaryText}`).join('\n- ')}` 
      : '',
      snapshot.worldStateAlerts.length > 0
      ? `世界状态告警：\n- ${snapshot.worldStateAlerts.map((item) => item.summary).join('\n- ')}`
      : '',
      snapshot.activeThreads.length > 0 ? `未回收线程：\n- ${snapshot.activeThreads.join('\n- ')}` : '',
      snapshot.timelineAnchors.length > 0 ? `时间锚点：\n- ${snapshot.timelineAnchors.join('\n- ')}` : '',
      snapshot.itemLedger.length > 0 ? `物品账本：\n- ${snapshot.itemLedger.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n'),
    observability: {
      ...observability,
      fallbackScopeCount: Math.max(observability.fallbackScopeCount, 1),
      summary: '当前 story memory prompt 已退回 snapshot 级文本摘要；结构化 checkpoint 观测仍保留供 dashboard 判断。',
    },
  }
}

function entityLabel(item: { entityType: WorldStateSummary['entityType'] }): string {
  switch (item.entityType) {
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
      return item.entityType
  }
}
