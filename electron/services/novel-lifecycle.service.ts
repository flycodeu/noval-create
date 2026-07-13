import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'

export type NovelLifecycleStatus = 'draft' | 'writing' | 'completed' | 'archived'

export interface NovelLifecycleChapterSnapshot {
  status?: string | null
  wordCount?: number | null
}

/**
 * Derive the project-level lifecycle from the durable chapter state.
 * Archived is an explicit user decision and is therefore never overwritten by
 * an automatic chapter transition.
 */
export function deriveNovelLifecycleStatus(
  currentStatus: string | null | undefined,
  chapterRows: NovelLifecycleChapterSnapshot[],
): NovelLifecycleStatus {
  if (currentStatus === 'archived') return 'archived'

  if (chapterRows.length > 0 && chapterRows.every((chapter) => chapter.status === 'final')) {
    return 'completed'
  }

  const hasProductionChapter = chapterRows.some((chapter) => (
    Number(chapter.wordCount || 0) > 0
    || chapter.status === 'writing'
    || chapter.status === 'draft'
    || chapter.status === 'reviewing'
    || chapter.status === 'final'
  ))

  return hasProductionChapter ? 'writing' : 'draft'
}

export function syncNovelLifecycleStatus(novelId: number): {
  previousStatus: NovelLifecycleStatus | string
  status: NovelLifecycleStatus
  changed: boolean
} | null {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) return null

  const chapterRows = db.select({ status: chapters.status, wordCount: chapters.wordCount })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  const status = deriveNovelLifecycleStatus(novel.status, chapterRows)
  const changed = status !== novel.status

  if (changed) {
    db.update(novels).set({
      status,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, novelId)).run()
  }

  return {
    previousStatus: novel.status || 'draft',
    status,
    changed,
  }
}
