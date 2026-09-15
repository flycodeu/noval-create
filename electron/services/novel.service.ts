import { preserveStyleApproval } from '../../src/shared/style-source'
import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mergeNarrativePolicySettings } from '../../src/shared/narrative-policy'
import {
  appendReaderFeedbackSettings,
  createReaderFeedbackSourceRef,
  parseReaderFeedbackSettings,
  preserveReaderFeedbackSettings,
  revokeReaderFeedbackSettings,
  throwReaderFeedbackError,
  type ReaderFeedbackScope,
  type ReaderFeedbackSentiment,
} from '../../src/shared/reader-feedback'
import { getBuiltinGenreRules, stringifyWorldRules } from '../../src/shared/genre-system'
import {
  normalizeOperatingMode,
  resolveOperatingMode,
  writeOperatingModeSettings,
} from '../../src/shared/operating-mode'
import { normalizeWorldRulesDraft, stringifyWorldRulesDraft } from '../../src/shared/world-rules-draft'
import { getDb, getSqlite } from '../database/db'
import { chapters, characters, genres, novels } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { recordAssetChangeEvent } from './asset-impact.service'
import { getNovelContextStatus, markNovelContextChanged } from './context-impact.service'
import { describeNovelLifecycle, syncNovelLifecycleStatus, syncNovelLifecycleStatuses } from './novel-lifecycle.service'

type NovelSourceCanonJsonFields = {
  historicalProfileJson: string
  sourceLedgerJson: string
  chapterSourceUsageJson: string
  factProvenanceJson: string
  projectCanonProfileJson: string
  canonConstraintSetJson: string
  canonSourceLedgerJson: string
  canonFactCardsJson: string
}

const NOVEL_SOURCE_CANON_FIELD_KEYS: Array<keyof NovelSourceCanonJsonFields> = [
  'historicalProfileJson',
  'sourceLedgerJson',
  'chapterSourceUsageJson',
  'factProvenanceJson',
  'projectCanonProfileJson',
  'canonConstraintSetJson',
  'canonSourceLedgerJson',
  'canonFactCardsJson',
]

const NOVEL_CHILD_TABLES_DELETE_FIRST = [
  'chapter_fact_extracts',
  'chapter_writeback_diffs',
  'chapter_batch_inspections',
  'chapter_batch_rollbacks',
]

const NOVEL_SCOPED_TABLES_DELETE_LAST = [
  'story_volumes',
  'story_parts',
  'chapters',
  'characters',
  'world_map',
  'story_arcs',
  'story_threads',
  'story_items',
  'story_facts',
  'timeline_events',
  'novels',
]

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function listExistingTables() {
  const sqlite = getSqlite()
  return sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => String((row as { name: string }).name))
}

function tableHasColumn(tableName: string, columnName: string) {
  return getSqlite()
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all()
    .some((row) => String((row as { name: string }).name) === columnName)
}

function deleteRowsIfTableExists(tableNames: Set<string>, tableName: string, whereSql: string, novelId: number) {
  if (!tableNames.has(tableName)) return
  getSqlite().prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${whereSql}`).run(novelId)
}

function deleteNovelScopedRows(tableNames: Set<string>, novelId: number) {
  deleteRowsIfTableExists(
    tableNames,
    'chapter_fact_extracts',
    'run_id IN (SELECT id FROM chapter_writeback_runs WHERE novel_id = ?)',
    novelId,
  )
  deleteRowsIfTableExists(
    tableNames,
    'chapter_writeback_diffs',
    'run_id IN (SELECT id FROM chapter_writeback_runs WHERE novel_id = ?)',
    novelId,
  )
  deleteRowsIfTableExists(
    tableNames,
    'chapter_batch_inspections',
    'snapshot_id IN (SELECT id FROM chapter_batch_snapshots WHERE novel_id = ?)',
    novelId,
  )
  deleteRowsIfTableExists(
    tableNames,
    'chapter_batch_rollbacks',
    'snapshot_id IN (SELECT id FROM chapter_batch_snapshots WHERE novel_id = ?)',
    novelId,
  )

  const scopedTables = listExistingTables()
    .filter((tableName) => tableName !== 'novels' && tableHasColumn(tableName, 'novel_id'))
    .filter((tableName) => !NOVEL_CHILD_TABLES_DELETE_FIRST.includes(tableName))
    .sort((left, right) => {
      const leftOrder = NOVEL_SCOPED_TABLES_DELETE_LAST.indexOf(left)
      const rightOrder = NOVEL_SCOPED_TABLES_DELETE_LAST.indexOf(right)
      if (leftOrder === -1 && rightOrder === -1) return left.localeCompare(right)
      if (leftOrder === -1) return -1
      if (rightOrder === -1) return 1
      return leftOrder - rightOrder
    })

  for (const tableName of scopedTables) {
    getSqlite().prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE novel_id = ?`).run(novelId)
  }
}

function normalizeWorldRulesJson(raw: string, genreName?: string) {
  try {
    return stringifyWorldRulesDraft(normalizeWorldRulesDraft(JSON.parse(raw) as unknown, genreName))
  } catch {
    return raw
  }
}

function decorateNovelRow<T extends {
  id: number
  launchMode?: string | null
  targetWords?: number | null
  status?: string | null
  lifecycleMode?: string | null
  settingsJson?: string | null
}>(row: T): T & { operatingMode: ReturnType<typeof resolveOperatingMode>; lifecycle: ReturnType<typeof describeNovelLifecycle> } {
  const chapterRows = getDb()
    .select()
    .from(chapters)
    .where(eq(chapters.novelId, row.id))
    .all()
  const chapterCount = chapterRows.length

  return {
    ...row,
    operatingMode: resolveOperatingMode({
      launchMode: row.launchMode,
      targetWords: row.targetWords,
      settingsJson: row.settingsJson,
      chapterCount,
    }),
    lifecycle: describeNovelLifecycle(row.status, chapterRows, row.lifecycleMode),
  }
}

function deriveNovelChangeReasons(
  current: typeof novels.$inferSelect,
  next: Partial<{
    title: string
    synopsis: string
    genreId: number
    launchMode: string
    userBackground: string
    status: string
    totalWords: number
    targetWords: number
    projectBriefJson: string
    settingsJson: string
    themeVoiceJson: string
    worldRulesJson: string
    blurbJson: string
    expandedBackground: string
    modelConfigId: number
    styleTemplateId: number
    worldTemplateId: number
  } & NovelSourceCanonJsonFields>,
): string[] {
  const reasons = new Set<string>()

  if (
    Object.prototype.hasOwnProperty.call(next, 'title')
    || Object.prototype.hasOwnProperty.call(next, 'synopsis')
    || Object.prototype.hasOwnProperty.call(next, 'userBackground')
    || Object.prototype.hasOwnProperty.call(next, 'expandedBackground')
    || Object.prototype.hasOwnProperty.call(next, 'projectBriefJson')
    || Object.prototype.hasOwnProperty.call(next, 'settingsJson')
    || Object.prototype.hasOwnProperty.call(next, 'themeVoiceJson')
  ) {
    reasons.add('Core story setup changed')
  }

  if (
    Object.prototype.hasOwnProperty.call(next, 'genreId')
    || Object.prototype.hasOwnProperty.call(next, 'worldRulesJson')
    || Object.prototype.hasOwnProperty.call(next, 'worldTemplateId')
  ) {
    reasons.add('World rules changed')
  }

  if (NOVEL_SOURCE_CANON_FIELD_KEYS.some((field) => Object.prototype.hasOwnProperty.call(next, field))) {
    reasons.add('Historical/source/canon data changed')
  }

  if (Object.prototype.hasOwnProperty.call(next, 'styleTemplateId')) {
    reasons.add('Writing style guide changed')
  }

  if (
    Object.prototype.hasOwnProperty.call(next, 'targetWords')
    && next.targetWords !== current.targetWords
  ) {
    reasons.add('Narrative planning targets changed')
  }

  return [...reasons]
}

export function listNovels(filters?: { status?: string; genreId?: number; search?: string }) {
  const db = getDb()
  // A project may have been changed by a recovered task, a local Web client,
  // or an older process. Reconcile before exposing the list so the card status
  // is always the durable lifecycle result rather than a stale cached label.
  syncNovelLifecycleStatuses()
  const query = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    launchMode: novels.launchMode,
    status: novels.status,
    lifecycleMode: novels.lifecycleMode,
    totalWords: novels.totalWords,
    targetWords: novels.targetWords,
    settingsJson: novels.settingsJson,
    coverImage: novels.coverImage,
    contextVersion: novels.contextVersion,
    createdAt: novels.createdAt,
    updatedAt: novels.updatedAt,
    genreName: genres.name,
    genreColorTag: genres.colorTag,
  })
    .from(novels)
    .leftJoin(genres, eq(novels.genreId, genres.id))

  const normalizedSearch = filters?.search?.trim().toLocaleLowerCase()
  return query.orderBy(desc(novels.updatedAt)).all()
    .map((row) => decorateNovelRow(row))
    .filter((novel) => {
      if (filters?.status && novel.status !== filters.status) return false
      if (typeof filters?.genreId === 'number' && novel.genreId !== filters.genreId) return false
      if (!normalizedSearch) return true
      return `${novel.title || ''}\n${novel.synopsis || ''}`
        .toLocaleLowerCase()
        .includes(normalizedSearch)
    })
}

export function getNovel(id: number) {
  const db = getDb()
  syncNovelLifecycleStatus(id)
  const rows = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    launchMode: novels.launchMode,
    status: novels.status,
    lifecycleMode: novels.lifecycleMode,
    totalWords: novels.totalWords,
    targetWords: novels.targetWords,
    coverImage: novels.coverImage,
    userBackground: novels.userBackground,
    expandedBackground: novels.expandedBackground,
    projectBriefJson: novels.projectBriefJson,
    settingsJson: novels.settingsJson,
    themeVoiceJson: novels.themeVoiceJson,
    historicalProfileJson: novels.historicalProfileJson,
    sourceLedgerJson: novels.sourceLedgerJson,
    chapterSourceUsageJson: novels.chapterSourceUsageJson,
    factProvenanceJson: novels.factProvenanceJson,
    projectCanonProfileJson: novels.projectCanonProfileJson,
    canonConstraintSetJson: novels.canonConstraintSetJson,
    canonSourceLedgerJson: novels.canonSourceLedgerJson,
    canonFactCardsJson: novels.canonFactCardsJson,
    worldRulesJson: novels.worldRulesJson,
    blurbJson: novels.blurbJson,
    styleTemplateId: novels.styleTemplateId,
    worldTemplateId: novels.worldTemplateId,
    contextVersion: novels.contextVersion,
    modelConfigId: novels.modelConfigId,
    createdAt: novels.createdAt,
    updatedAt: novels.updatedAt,
    genreName: genres.name,
    genreColorTag: genres.colorTag,
  })
    .from(novels)
    .leftJoin(genres, eq(novels.genreId, genres.id))
    .where(eq(novels.id, id))
    .all()

  return rows[0] ? decorateNovelRow(rows[0]) : null
}

export function createNovel(data: {
  title: string
  synopsis?: string
  genreId?: number
  launchMode?: string
  operatingMode?: string
  userBackground?: string
  expandedBackground?: string
  projectBriefJson?: string
  settingsJson?: string
  themeVoiceJson?: string
  styleTemplateId?: number
  worldTemplateId?: number
  targetWords?: number
  modelConfigId?: number
  blurbJson?: string
} & Partial<NovelSourceCanonJsonFields>) {
  const db = getDb()
  const genre = data.genreId
    ? db.select().from(genres).where(eq(genres.id, data.genreId)).all()[0]
    : null
  const { operatingMode: _operatingMode, ...dbData } = data
  const explicitOperatingMode = normalizeOperatingMode(data.operatingMode)

  const result = db.insert(novels).values({
    ...dbData,
    settingsJson: explicitOperatingMode
      ? writeOperatingModeSettings(data.settingsJson, explicitOperatingMode, true)
      : data.settingsJson,
    status: 'draft',
    lifecycleMode: 'automatic',
    totalWords: 0,
    worldRulesJson: stringifyWorldRules(getBuiltinGenreRules(genre?.name)),
  }).run()

  return Number(result.lastInsertRowid)
}

export function updateNovel(id: number, data: Partial<{
  title: string
  synopsis: string
  genreId: number
  launchMode: string
  operatingMode: string
  userBackground: string
  status: string
  totalWords: number
  targetWords: number
  projectBriefJson: string
  settingsJson: string
  themeVoiceJson: string
  worldRulesJson: string
  blurbJson: string
  expandedBackground: string
  modelConfigId: number
  styleTemplateId: number
  worldTemplateId: number
} & NovelSourceCanonJsonFields>) {
  const db = getDb()
  const current = db.select().from(novels).where(eq(novels.id, id)).all()[0]

  if (!current) {
    throwUserFacingError('novel.notFound')
  }

  const nextGenreId = typeof data.genreId === 'number' ? data.genreId : current.genreId || undefined
  const nextGenre = nextGenreId
    ? db.select().from(genres).where(eq(genres.id, nextGenreId)).all()[0]
    : null

  let normalizedWorldRules = data.worldRulesJson
  if (typeof data.worldRulesJson === 'string') {
    normalizedWorldRules = normalizeWorldRulesJson(data.worldRulesJson, nextGenre?.name)
  } else if (Object.prototype.hasOwnProperty.call(data, 'genreId')) {
    if (typeof current.worldRulesJson === 'string' && current.worldRulesJson.trim()) {
      normalizedWorldRules = normalizeWorldRulesJson(current.worldRulesJson, nextGenre?.name)
    } else {
      normalizedWorldRules = stringifyWorldRules(getBuiltinGenreRules(nextGenre?.name))
    }
  }

  const explicitOperatingMode = normalizeOperatingMode(data.operatingMode)
  const normalizedSettingsJson = explicitOperatingMode
    ? writeOperatingModeSettings(data.settingsJson ?? current.settingsJson, explicitOperatingMode, true)
    : data.settingsJson
  const { operatingMode: _operatingMode, ...dbData } = data
  const lifecycleMode = Object.prototype.hasOwnProperty.call(data, 'status') ? 'manual' : current.lifecycleMode || 'automatic'

  const changeReasons = deriveNovelChangeReasons(current, data)
  const feedbackProtectedSettings = normalizedSettingsJson === undefined
    ? undefined
    : preserveReaderFeedbackSettings(current.settingsJson, normalizedSettingsJson)

  db.update(novels).set({
    ...dbData,
    lifecycleMode,
    settingsJson: feedbackProtectedSettings === undefined ? undefined : preserveStyleApproval(current.settingsJson,
      mergeNarrativePolicySettings(current.settingsJson, feedbackProtectedSettings)),
    worldRulesJson: normalizedWorldRules,
    updatedAt: new Date().toISOString(),
  }).where(eq(novels.id, id)).run()

  if (changeReasons.length > 0) {
    markNovelContextChanged(id, changeReasons)
    recordAssetChangeEvent({
      novelId: id,
      assetType: 'novel',
      assetId: id,
      assetLabel: data.title || current.title,
      operation: 'update',
      changeReason: changeReasons.join('；'),
      impactLevel: 'high',
      triggeredBy: 'novel.service',
      payload: data,
    })
  }
}

export interface SaveNovelReaderFeedbackInput {
  expectedRevision: number
  chapterId: number
  start: number
  end: number
  note: string
  topic: string
  sentiment: ReaderFeedbackSentiment
  scope: ReaderFeedbackScope
}

function getReaderFeedbackNovel(id: number) {
  const novel = getDb().select().from(novels).where(eq(novels.id, id)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  return novel
}

function assertReaderFeedbackScopeBelongsToNovel(
  novelId: number,
  chapter: typeof chapters.$inferSelect,
  scope: ReaderFeedbackScope,
) {
  if (scope.type === 'character') {
    const candidates = getDb().select().from(characters).where(eq(characters.novelId, novelId)).all()
    const character = scope.characterId !== undefined
      ? candidates.find((entry) => entry.id === scope.characterId)
      : candidates.find((entry) => entry.fullName === scope.characterName)
    if (!character || !scope.characterName || character.fullName !== scope.characterName) {
      throwReaderFeedbackError('RF_FEEDBACK_CHARACTER_SCOPE_MISMATCH')
    }
  }
  if (scope.type === 'scene') {
    let plan: unknown = null
    try { plan = JSON.parse(chapter.scenePlanJson || 'null') } catch { /* Invalid old plans cannot prove scene scope. */ }
    const exists = Array.isArray(plan) && plan.some((entry) => entry && typeof entry === 'object'
      && !Array.isArray(entry) && (entry as Record<string, unknown>).scene_order === scope.sceneOrder)
    if (!exists) throwReaderFeedbackError('RF_FEEDBACK_SCENE_SCOPE_MISMATCH')
  }
}

export function getNovelReaderFeedback(novelId: number) {
  return parseReaderFeedbackSettings(getReaderFeedbackNovel(novelId).settingsJson)
}

/** Writes feedback into the latest settings JSON so unrelated model and story settings survive. */
export function saveNovelReaderFeedback(novelId: number, input: SaveNovelReaderFeedbackInput) {
  const db = getDb()
  const novel = getReaderFeedbackNovel(novelId)
  const chapter = db.select().from(chapters).where(eq(chapters.id, input.chapterId)).all()[0]
  if (!chapter || chapter.novelId !== novelId) throwReaderFeedbackError('RF_FEEDBACK_CHAPTER_SCOPE_MISMATCH')
  assertReaderFeedbackScopeBelongsToNovel(novelId, chapter, input.scope)
  const timestamp = new Date().toISOString()
  const result = appendReaderFeedbackSettings(novel.settingsJson, input.expectedRevision, {
    id: randomUUID(),
    novelId,
    source: createReaderFeedbackSourceRef(chapter.content || '', chapter.id, input.start, input.end),
    note: input.note,
    topic: input.topic,
    sentiment: input.sentiment,
    scope: input.scope,
    status: 'approved',
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  if (!result.changed) return result
  db.update(novels).set({ settingsJson: result.settingsJson, updatedAt: timestamp }).where(eq(novels.id, novelId)).run()
  markNovelContextChanged(novelId, ['Author feedback changed'])
  return result
}

export function revokeNovelReaderFeedback(novelId: number, input: { id: string; expectedRevision: number }) {
  const db = getDb()
  const novel = getReaderFeedbackNovel(novelId)
  const timestamp = new Date().toISOString()
  const result = revokeReaderFeedbackSettings(novel.settingsJson, { ...input, revokedAt: timestamp })
  if (!result.changed) return result
  db.update(novels).set({ settingsJson: result.settingsJson, updatedAt: timestamp }).where(eq(novels.id, novelId)).run()
  markNovelContextChanged(novelId, ['Author feedback revoked'])
  return result
}

export function deleteNovel(id: number) {
  const sqlite = getSqlite()
  sqlite.transaction(() => {
    const tableNames = new Set(listExistingTables())
    deleteNovelScopedRows(tableNames, id)
    sqlite.prepare('DELETE FROM novels WHERE id = ?').run(id)
  })()
}

export function getNovelStats(id: number) {
  const db = getDb()
  const chapterList = db.select().from(chapters).where(eq(chapters.novelId, id)).all()
  const charList = db.select().from(characters).where(eq(characters.novelId, id)).all()

  const totalWords = chapterList.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)
  const completedChapters = chapterList.filter((chapter) => chapter.status === 'final').length

  return {
    totalChapters: chapterList.length,
    completedChapters,
    totalWords,
    characterCount: charList.length,
  }
}

export { getNovelContextStatus }


