import { getDb } from '../database/db'
import { novels, genres, chapters, characters } from '../database/schema'
import { eq, desc } from 'drizzle-orm'
import { normalizeWorldRules, stringifyWorldRules, getBuiltinGenreRules } from '../../src/shared/genre-system'

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
  let normalizedWorldRules = data.worldRulesJson
  if (typeof data.worldRulesJson === 'string') {
    const current = db.select().from(novels).where(eq(novels.id, id)).all()[0]
    const genre = current?.genreId
      ? db.select().from(genres).where(eq(genres.id, current.genreId)).all()[0]
      : null
    try {
      normalizedWorldRules = stringifyWorldRules(normalizeWorldRules(JSON.parse(data.worldRulesJson) as unknown, genre?.name))
    } catch {
      normalizedWorldRules = data.worldRulesJson
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

  const totalWords = chapterList.reduce((sum, c) => sum + (c.wordCount || 0), 0)
  const completedChapters = chapterList.filter(c => c.status === 'final').length

  return {
    totalChapters: chapterList.length,
    completedChapters,
    totalWords,
    characterCount: charList.length,
  }
}
