import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapters, storyArcs } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { markNovelContextChanged } from './context-impact.service'

const STORY_ARC_WRITABLE_FIELDS = [
  'arcName',
  'arcOrder',
  'chapterStart',
  'chapterEnd',
  'arcGoal',
  'arcSummary',
  'growthLedger',
  'costLedger',
  'phaseTargetsJson',
  'targetWords',
  'progressPercent',
  'stalledChapterCount',
  'lastProgressChapterNum',
  'rhythmTemplateKey',
] as const

type StoryArcPatch = Partial<Pick<typeof storyArcs.$inferInsert, typeof STORY_ARC_WRITABLE_FIELDS[number]>>

export function sanitizeStoryArcPatch(value: unknown): StoryArcPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    STORY_ARC_WRITABLE_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  ) as StoryArcPatch
}

export function listStoryArcs(novelId: number) {
  return getDb().select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
}

export function getStoryArc(id: number) {
  return getDb().select().from(storyArcs).where(eq(storyArcs.id, id)).all()[0] || null
}

export function createStoryArc(novelId: number, value: unknown): number {
  const patch = sanitizeStoryArcPatch(value)
  return getSqlite().transaction(() => {
    const result = getDb().insert(storyArcs).values({
      ...patch,
      novelId,
    } as typeof storyArcs.$inferInsert).run()
    markNovelContextChanged(novelId, 'Story outline changed')
    return Number(result.lastInsertRowid)
  })()
}

export function updateStoryArc(id: number, value: unknown) {
  const current = getStoryArc(id)
  if (!current) throwUserFacingError('storyArc.notFound')

  const patch = sanitizeStoryArcPatch(value)
  if (Object.keys(patch).length > 0) {
    getSqlite().transaction(() => {
      getDb().update(storyArcs).set(patch).where(eq(storyArcs.id, id)).run()
      markNovelContextChanged(current.novelId, 'Story outline changed')
    })()
  }
  return { ...current, ...patch }
}

export function deleteStoryArc(id: number): void {
  const current = getStoryArc(id)
  if (!current) throwUserFacingError('storyArc.notFound')
  getSqlite().transaction(() => {
    // chapters.arc_id predates the FK-backed timeline reference, so SQLite cannot
    // clear it automatically when an arc is deleted.
    getDb().update(chapters).set({ arcId: null }).where(eq(chapters.arcId, id)).run()
    getDb().delete(storyArcs).where(eq(storyArcs.id, id)).run()
    markNovelContextChanged(current.novelId, 'Story outline changed')
  })()
}

export function clearStoryArcs(novelId: number): void {
  const db = getDb()
  getSqlite().transaction(() => {
    db.update(chapters).set({
      arcId: null,
      outline: null,
      emotionTone: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.novelId, novelId)).run()
    db.delete(storyArcs).where(eq(storyArcs.novelId, novelId)).run()
    markNovelContextChanged(novelId, 'Story outline changed')
  })()
}
