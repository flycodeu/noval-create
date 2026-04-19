import { desc, eq } from 'drizzle-orm'
import { getBuiltinGenreRules, stringifyWorldRules } from '../../src/shared/genre-system'
import { normalizeWorldRulesDraft, stringifyWorldRulesDraft } from '../../src/shared/world-rules-draft'
import { getDb } from '../database/db'
import { chapters, characters, genres, novels } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { recordAssetChangeEvent } from './asset-impact.service'
import { getNovelContextStatus, markNovelContextChanged } from './context-impact.service'

function normalizeWorldRulesJson(raw: string, genreName?: string) {
  try {
    return stringifyWorldRulesDraft(normalizeWorldRulesDraft(JSON.parse(raw) as unknown, genreName))
  } catch {
    return raw
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
  }>,
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
    coverImage: novels.coverImage,
    contextVersion: novels.contextVersion,
    createdAt: novels.createdAt,
    updatedAt: novels.updatedAt,
    genreName: genres.name,
    genreColorTag: genres.colorTag,
  })
    .from(novels)
    .leftJoin(genres, eq(novels.genreId, genres.id))

  return query.orderBy(desc(novels.updatedAt)).all()
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

  return rows[0] || null
}

export function createNovel(data: {
  title: string
  synopsis?: string
  genreId?: number
  launchMode?: string
  userBackground?: string
  expandedBackground?: string
  projectBriefJson?: string
  styleTemplateId?: number
  worldTemplateId?: number
  targetWords?: number
  modelConfigId?: number
  blurbJson?: string
}) {
  const db = getDb()
  const genre = data.genreId
    ? db.select().from(genres).where(eq(genres.id, data.genreId)).all()[0]
    : null

  const result = db.insert(novels).values({
    ...data,
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
}>) {
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

  const changeReasons = deriveNovelChangeReasons(current, data)

  db.update(novels).set({
    ...data,
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
  const db = getDb()
  db.delete(novels).where(eq(novels.id, id)).run()
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


