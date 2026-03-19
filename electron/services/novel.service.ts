import { desc, eq } from 'drizzle-orm'
import { getBuiltinGenreRules, normalizeWorldRules, stringifyWorldRules } from '../../src/shared/genre-system'
import { getDb } from '../database/db'
import { chapters, characters, genres, novels } from '../database/schema'

function normalizeWorldRulesJson(raw: string, genreName?: string) {
  try {
    return stringifyWorldRules(normalizeWorldRules(JSON.parse(raw) as unknown, genreName))
  } catch {
    return raw
  }
}

export function listNovels(filters?: { status?: string; genreId?: number; search?: string }) {
  const db = getDb()
  let query = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    status: novels.status,
    totalWords: novels.totalWords,
    targetWords: novels.targetWords,
    coverImage: novels.coverImage,
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
    status: novels.status,
    totalWords: novels.totalWords,
    targetWords: novels.targetWords,
    coverImage: novels.coverImage,
    userBackground: novels.userBackground,
    expandedBackground: novels.expandedBackground,
    settingsJson: novels.settingsJson,
    worldRulesJson: novels.worldRulesJson,
    styleTemplateId: novels.styleTemplateId,
    worldTemplateId: novels.worldTemplateId,
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
  userBackground?: string
  expandedBackground?: string
  styleTemplateId?: number
  worldTemplateId?: number
  targetWords?: number
  modelConfigId?: number
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
  userBackground: string
  status: string
  totalWords: number
  targetWords: number
  settingsJson: string
  worldRulesJson: string
  expandedBackground: string
  modelConfigId: number
  styleTemplateId: number
  worldTemplateId: number
}>) {
  const db = getDb()
  const current = db.select().from(novels).where(eq(novels.id, id)).all()[0]

  if (!current) {
    throw new Error('小说不存在')
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

  db.update(novels).set({
    ...data,
    worldRulesJson: normalizedWorldRules,
    updatedAt: new Date().toISOString(),
  }).where(eq(novels.id, id)).run()
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
