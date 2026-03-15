import { getDb } from '../database/db'
import { novels, genres, chapters, characters, characterRelations, worldMap, storyArcs, tasks } from '../database/schema'
import { eq, desc, like, and } from 'drizzle-orm'

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
  const rows = db.select().from(novels).where(eq(novels.id, id)).all()
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
  const result = db.insert(novels).values({
    ...data,
    status: 'draft',
    totalWords: 0,
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
  db.update(novels).set({
    ...data,
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
