import { desc, eq } from 'drizzle-orm'
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
  settingsJson?: string | null
}>(row: T): T & { operatingMode: ReturnType<typeof resolveOperatingMode> } {
  const chapterCount = getDb()
    .select()
    .from(chapters)
    .where(eq(chapters.novelId, row.id))
    .all()
    .length

  return {
    ...row,
    operatingMode: resolveOperatingMode({
      launchMode: row.launchMode,
      targetWords: row.targetWords,
      settingsJson: row.settingsJson,
      chapterCount,
    }),
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
  let query = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    launchMode: novels.launchMode,
    status: novels.status,
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

  return query.orderBy(desc(novels.updatedAt)).all().map((row) => decorateNovelRow(row))
}

export function getNovel(id: number) {
  const db = getDb()
  const rows = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    launchMode: novels.launchMode,
    status: novels.status,
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
  const { operatingMode, ...dbData } = data
  const explicitOperatingMode = normalizeOperatingMode(data.operatingMode)

  const result = db.insert(novels).values({
    ...dbData,
    settingsJson: explicitOperatingMode
      ? writeOperatingModeSettings(data.settingsJson, explicitOperatingMode, true)
      : data.settingsJson,
    status: 'draft',
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
  const { operatingMode, ...dbData } = data

  const changeReasons = deriveNovelChangeReasons(current, data)

  db.update(novels).set({
    ...dbData,
    settingsJson: normalizedSettingsJson,
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


